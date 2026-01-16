/**
 * 视频处理引擎
 * 负责视频剪辑、格式转换、字幕生成和视频合并
 * 使用FFmpeg进行视频处理
 */

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const ResumableProcessor = require("../utils/resumable-processor");
const ProgressEmitter = require("../utils/progress-emitter");

class VideoEngine extends EventEmitter {
  constructor(llmManager = null) {
    super();
    this.llmManager = llmManager;

    // v0.18.0: 集成错误恢复和进度通知系统
    this.resumableProcessor = new ResumableProcessor({
      maxRetries: 3,
      retryDelay: 2000,
      checkpointInterval: 10,
    });
    this.progressEmitter = new ProgressEmitter({
      autoForwardToIPC: true,
      throttleInterval: 200,
    });

    // 初始化处理器
    this.resumableProcessor.initialize().catch((err) => {
      console.error("[VideoEngine] ResumableProcessor 初始化失败:", err);
    });

    // 支持的视频格式
    this.supportedFormats = ["mp4", "avi", "mov", "mkv", "flv", "webm", "wmv"];

    // 支持的字幕格式
    this.supportedSubtitleFormats = ["srt", "ass", "vtt"];

    // 预设配置
    this.presets = {
      "1080p": {
        width: 1920,
        height: 1080,
        videoBitrate: "5000k",
        audioBitrate: "192k",
      },
      "720p": {
        width: 1280,
        height: 720,
        videoBitrate: "2500k",
        audioBitrate: "128k",
      },
      "480p": {
        width: 854,
        height: 480,
        videoBitrate: "1000k",
        audioBitrate: "96k",
      },
    };

    // v0.18.0: 视频滤镜预设（13种）
    this.filterPresets = {
      blur: (intensity = 1) => `boxblur=${intensity * 5}:1`,
      sharpen: (intensity = 1) => `unsharp=5:5:${intensity}:5:5:0`,
      grayscale: () => "hue=s=0",
      sepia: () =>
        "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
      vignette: (intensity = 1) => `vignette=PI/${intensity * 4}`,
      brightness: (intensity = 1) => `eq=brightness=${(intensity - 1) * 0.5}`,
      contrast: (intensity = 1) => `eq=contrast=${intensity}`,
      saturation: (intensity = 1) => `eq=saturation=${intensity}`,
      negative: () => "negate",
      mirror: () => "hflip",
      flip: () => "vflip",
      vintage: () => "curves=vintage",
      cartoon: () => "edgedetect=low=0.1:high=0.4",
    };

    // v0.18.0: 字幕样式预设（4种风格）
    this.subtitlePresets = {
      default: {
        fontName: "Arial",
        fontSize: 24,
        fontColor: "FFFFFF",
        outlineColor: "000000",
        outlineWidth: 2,
        bold: false,
        italic: false,
        position: "bottom",
        marginV: 20,
        shadowDepth: 2,
        glowEffect: false,
      },
      cinema: {
        fontName: "Arial",
        fontSize: 28,
        fontColor: "FFFFFF",
        outlineColor: "000000",
        outlineWidth: 3,
        bold: true,
        italic: false,
        position: "bottom",
        marginV: 40,
        shadowDepth: 3,
        glowEffect: false,
      },
      minimal: {
        fontName: "Helvetica",
        fontSize: 20,
        fontColor: "FFFFFF",
        outlineColor: "202020",
        outlineWidth: 1,
        bold: false,
        italic: false,
        position: "bottom",
        marginV: 15,
        shadowDepth: 0,
        glowEffect: false,
      },
      bold: {
        fontName: "Arial Black",
        fontSize: 26,
        fontColor: "FFFF00",
        outlineColor: "000000",
        outlineWidth: 3,
        bold: true,
        italic: false,
        position: "bottom",
        marginV: 25,
        shadowDepth: 2,
        glowEffect: true,
      },
    };
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增滤镜、音轨处理任务
   * v0.18.0: 集成统一进度通知和错误恢复
   */
  async handleProjectTask(params, onProgress = null) {
    const { taskType, inputPath, outputPath, options = {} } = params;

    console.log("[Video Engine] 执行任务:", taskType);

    // 创建任务追踪器
    const taskId = `video_${taskType}_${Date.now()}`;
    const tracker = this.progressEmitter.createTracker(taskId, {
      title: `视频${taskType}处理`,
      description: `处理: ${path.basename(inputPath || "未知")}`,
      totalSteps: 100,
      metadata: { taskType, inputPath, outputPath },
    });

    // 进度回调包装器
    const progressCallback = (percent, message = "") => {
      tracker.setPercent(percent, message);
      if (onProgress) {
        onProgress({ percent, message, taskType });
      }
    };

    try {
      tracker.setStage(ProgressEmitter.Stage.PREPARING, "准备处理...");

      let result;

      tracker.setStage(ProgressEmitter.Stage.PROCESSING, "开始处理...");

      switch (taskType) {
        case "convert":
          result = await this.convertFormat(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "trim":
          result = await this.trimVideo(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "merge":
          result = await this.mergeVideos(
            params.videoList,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "addSubtitles":
          result = await this.addSubtitles(
            inputPath,
            params.subtitlePath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "extractAudio":
          result = await this.extractAudio(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "generateThumbnail":
          result = await this.generateThumbnail(inputPath, outputPath, options);
          break;

        case "compress":
          result = await this.compressVideo(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "generateSubtitles":
          result = await this.generateSubtitlesWithAI(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        // v0.18.0: 新增滤镜功能
        case "applyFilter":
          result = await this.applyFilter(
            inputPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "applyFilterChain":
          result = await this.applyFilterChain(
            inputPath,
            outputPath,
            options.filters,
            progressCallback,
          );
          break;

        // v0.18.0: 新增音轨处理功能
        case "separateAudio":
          result = await this.separateAudioTracks(
            inputPath,
            params.outputDir,
            options,
          );
          break;

        case "replaceAudio":
          result = await this.replaceAudio(
            inputPath,
            params.audioPath,
            outputPath,
            options,
            progressCallback,
          );
          break;

        case "adjustVolume":
          result = await this.adjustVolume(
            inputPath,
            outputPath,
            options.volumeLevel,
            options,
            progressCallback,
          );
          break;

        default:
          throw new Error(`不支持的任务类型: ${taskType}`);
      }

      // 任务完成
      tracker.setStage(ProgressEmitter.Stage.FINALIZING, "完成处理...");
      progressCallback(100, "处理完成");
      tracker.complete({ result });

      return result;
    } catch (error) {
      console.error(`[VideoEngine] 任务失败 (${taskType}):`, error);
      tracker.error(error);
      throw error;
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
      format = "mp4",
      videoBitrate = "2000k",
      audioBitrate = "128k",
      fps = null,
      codec = "libx264",
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
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在转换视频: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 格式转换完成");
          resolve({
            success: true,
            outputPath: outputPath,
            format: format,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 格式转换失败:", error);
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
    const { startTime = "00:00:00", duration = null, endTime = null } = options;

    console.log(
      `[Video Engine] 剪辑视频: ${startTime} ~ ${endTime || duration}`,
    );

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
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在剪辑视频: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 视频剪辑完成");
          resolve({
            success: true,
            outputPath: outputPath,
            startTime: startTime,
            duration: duration,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 视频剪辑失败:", error);
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
    const { transition = "concat" } = options;

    console.log(`[Video Engine] 合并 ${videoList.length} 个视频文件`);

    // 创建临时文件列表
    const listFilePath = path.join(path.dirname(outputPath), "concat_list.txt");
    const listContent = videoList.map((video) => `file '${video}'`).join("\n");
    await fs.writeFile(listFilePath, listContent, "utf-8");

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(listFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions("-c copy")
        .output(outputPath);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在合并视频: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", async () => {
          // 删除临时文件
          try {
            await fs.unlink(listFilePath);
          } catch (error) {
            console.warn("[Video Engine] 删除临时文件失败:", error);
          }

          console.log("[Video Engine] 视频合并完成");
          resolve({
            success: true,
            outputPath: outputPath,
            videoCount: videoList.length,
          });
        })
        .on("error", async (error) => {
          // 删除临时文件
          try {
            await fs.unlink(listFilePath);
          } catch (err) {
            console.warn("[Video Engine] 删除临时文件失败:", err);
          }

          console.error("[Video Engine] 视频合并失败:", error);
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
   *
   * v0.18.0: 扩展支持10+自定义样式参数
   */
  async addSubtitles(
    inputPath,
    subtitlePath,
    outputPath,
    options = {},
    onProgress = null,
  ) {
    const {
      fontName = "Arial",
      fontSize = 24,
      fontColor = "FFFFFF",
      outlineColor = "000000",
      outlineWidth = 2,
      bold = false,
      italic = false,
      position = "bottom",
      marginV = 20,
      shadowDepth = 2,
      glowEffect = false,
    } = options;

    console.log(`[Video Engine] 添加字幕: ${subtitlePath}`);

    // 构建ASS样式字符串
    const styleParams = [
      `FontName=${fontName}`,
      `FontSize=${fontSize}`,
      `PrimaryColour=&H${fontColor}`,
      `OutlineColour=&H${outlineColor}`,
      `Outline=${outlineWidth}`,
      `Shadow=${shadowDepth}`,
      `MarginV=${marginV}`,
      `Bold=${bold ? "-1" : "0"}`,
      `Italic=${italic ? "-1" : "0"}`,
    ];

    // 发光效果（通过增加边框模拟）
    if (glowEffect) {
      styleParams.push("BackColour=&H40000000");
    }

    const forceStyle = styleParams.join(",");

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoFilters([
          {
            filter: "subtitles",
            options: {
              filename: subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:"),
              force_style: forceStyle,
            },
          },
        ]);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在添加字幕: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 字幕添加完成");
          resolve({
            success: true,
            outputPath: outputPath,
            style: {
              fontName,
              fontSize,
              fontColor,
              bold,
              italic,
            },
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 字幕添加失败:", error);
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
    const { format = "mp3", bitrate = "192k", channels = 2 } = options;

    console.log(`[Video Engine] 提取音频: ${inputPath}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate(bitrate)
        .audioChannels(channels)
        .format(format);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在提取音频: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 音频提取完成");
          resolve({
            success: true,
            outputPath: outputPath,
            format: format,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 音频提取失败:", error);
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
    const { timeOffset = "00:00:01", size = "320x240" } = options;

    console.log(`[Video Engine] 生成缩略图: ${inputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timeOffset],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: size,
        })
        .on("end", () => {
          console.log("[Video Engine] 缩略图生成完成");
          resolve({
            success: true,
            outputPath: outputPath,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 缩略图生成失败:", error);
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
      preset = "720p",
      crf = 23, // 质量参数：0-51，值越小质量越好，文件越大
    } = options;

    const presetConfig = this.presets[preset] || this.presets["720p"];

    console.log(`[Video Engine] 压缩视频: ${preset} (CRF=${crf})`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec("libx264")
        .size(`${presetConfig.width}x${presetConfig.height}`)
        .outputOptions([`-crf ${crf}`, "-preset medium"])
        .audioBitrate(presetConfig.audioBitrate);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在压缩视频: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 视频压缩完成");
          resolve({
            success: true,
            outputPath: outputPath,
            preset: preset,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 视频压缩失败:", error);
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
  async generateSubtitlesWithAI(
    inputPath,
    outputPath,
    options = {},
    onProgress = null,
  ) {
    const { language = "zh" } = options;

    console.log(`[Video Engine] 使用AI生成字幕 (语言: ${language})`);

    try {
      // 1. 提取音频
      if (onProgress) {
        onProgress({ percent: 10, message: "正在提取音频..." });
      }

      const audioPath = path.join(path.dirname(outputPath), "temp_audio.mp3");
      await this.extractAudio(inputPath, audioPath, { format: "mp3" });

      // 2. 使用LLM转录音频（如果有Whisper或类似服务）
      if (onProgress) {
        onProgress({ percent: 30, message: "正在转录音频..." });
      }

      // 注意：这里需要集成Whisper API或其他语音识别服务
      // 由于这是示例，我们使用LLM生成示例字幕
      const subtitles = await this.generateSubtitlesContent(
        audioPath,
        language,
      );

      // 3. 保存字幕文件
      if (onProgress) {
        onProgress({ percent: 80, message: "正在保存字幕..." });
      }

      await fs.writeFile(outputPath, subtitles, "utf-8");

      // 4. 清理临时文件
      try {
        await fs.unlink(audioPath);
      } catch (error) {
        console.warn("[Video Engine] 删除临时音频文件失败:", error);
      }

      if (onProgress) {
        onProgress({ percent: 100, message: "字幕生成完成" });
      }

      console.log("[Video Engine] AI字幕生成完成");
      return {
        success: true,
        outputPath: outputPath,
        language: language,
      };
    } catch (error) {
      console.error("[Video Engine] AI字幕生成失败:", error);
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
          console.error("[Video Engine] 获取视频信息失败:", error);
          reject(error);
        } else {
          const videoStream = metadata.streams.find(
            (s) => s.codec_type === "video",
          );
          const audioStream = metadata.streams.find(
            (s) => s.codec_type === "audio",
          );

          resolve({
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            format: metadata.format.format_name,
            streams: metadata.streams,
            video: videoStream
              ? {
                  codec: videoStream.codec_name,
                  width: videoStream.width,
                  height: videoStream.height,
                  fps: this._parseFrameRate(videoStream.r_frame_rate),
                }
              : null,
            audio: audioStream
              ? {
                  codec: audioStream.codec_name,
                  sampleRate: audioStream.sample_rate,
                  channels: audioStream.channels,
                }
              : null,
          });
        }
      });
    });
  }

  /**
   * 应用单个滤镜
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Object} options - 滤镜选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法
   */
  async applyFilter(inputPath, outputPath, options = {}, onProgress = null) {
    const {
      filterType = "grayscale",
      intensity = 1,
      customFilters = [],
    } = options;

    console.log(`[Video Engine] 应用滤镜: ${filterType} (强度: ${intensity})`);

    // 检查滤镜是否存在
    if (!this.filterPresets[filterType] && customFilters.length === 0) {
      throw new Error(`不支持的滤镜类型: ${filterType}`);
    }

    return new Promise((resolve, reject) => {
      const filters = [];

      // 添加预设滤镜
      if (this.filterPresets[filterType]) {
        filters.push(this.filterPresets[filterType](intensity));
      }

      // 添加自定义滤镜
      if (customFilters.length > 0) {
        filters.push(...customFilters);
      }

      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoFilters(filters);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在应用滤镜: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 滤镜应用完成");
          resolve({
            success: true,
            outputPath: outputPath,
            filterType: filterType,
            intensity: intensity,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 滤镜应用失败:", error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 应用滤镜链（多个滤镜组合）
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Array} filterChain - 滤镜链配置
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法
   */
  async applyFilterChain(
    inputPath,
    outputPath,
    filterChain = [],
    onProgress = null,
  ) {
    console.log(`[Video Engine] 应用滤镜链: ${filterChain.length}个滤镜`);

    if (filterChain.length === 0) {
      throw new Error("滤镜链不能为空");
    }

    return new Promise((resolve, reject) => {
      const filters = [];

      // 构建滤镜链
      for (const filter of filterChain) {
        const { type, intensity = 1, custom } = filter;

        if (custom) {
          // 自定义FFmpeg滤镜字符串
          filters.push(custom);
        } else if (this.filterPresets[type]) {
          // 预设滤镜
          filters.push(this.filterPresets[type](intensity));
        } else {
          console.warn(`[Video Engine] 未知滤镜类型: ${type}，跳过`);
        }
      }

      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoFilters(filters);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在应用滤镜链: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 滤镜链应用完成");
          resolve({
            success: true,
            outputPath: outputPath,
            filterCount: filters.length,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 滤镜链应用失败:", error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 分离音轨（支持多音轨视频）
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputDir - 输出目录
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 分离结果
   *
   * v0.18.0: 新增方法
   */
  async separateAudioTracks(inputPath, outputDir, options = {}) {
    const { format = "mp3", bitrate = "192k" } = options;

    console.log(`[Video Engine] 分离音轨: ${inputPath}`);

    try {
      // 获取视频信息
      const info = await this.getVideoInfo(inputPath);
      const audioStreams = info.streams.filter((s) => s.codec_type === "audio");

      if (audioStreams.length === 0) {
        throw new Error("视频不包含音轨");
      }

      console.log(`[Video Engine] 检测到 ${audioStreams.length} 个音轨`);

      // 确保输出目录存在
      await fs.mkdir(outputDir, { recursive: true });

      const results = [];

      // 分离每个音轨
      for (let i = 0; i < audioStreams.length; i++) {
        const outputPath = path.join(outputDir, `audio_track_${i}.${format}`);

        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .output(outputPath)
            .outputOptions([`-map 0:a:${i}`, "-vn"])
            .audioCodec("libmp3lame")
            .audioBitrate(bitrate)
            .on("end", () => {
              console.log(`[Video Engine] 音轨 ${i} 分离完成`);
              resolve();
            })
            .on("error", (error) => {
              console.error(`[Video Engine] 音轨 ${i} 分离失败:`, error);
              reject(error);
            })
            .run();
        });

        results.push({
          trackIndex: i,
          outputPath: outputPath,
          codec: audioStreams[i].codec_name,
          channels: audioStreams[i].channels,
        });
      }

      return {
        success: true,
        trackCount: audioStreams.length,
        tracks: results,
      };
    } catch (error) {
      console.error("[Video Engine] 分离音轨失败:", error);
      throw error;
    }
  }

  /**
   * 替换音轨
   * @param {string} videoPath - 视频文件路径
   * @param {string} audioPath - 音频文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法
   */
  async replaceAudio(
    videoPath,
    audioPath,
    outputPath,
    options = {},
    onProgress = null,
  ) {
    const { removeOriginalAudio = true } = options;

    console.log(`[Video Engine] 替换音轨: ${audioPath}`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .output(outputPath)
        .outputOptions(["-c:v copy", "-c:a aac", "-map 0:v:0", "-map 1:a:0"]);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在替换音轨: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 音轨替换完成");
          resolve({
            success: true,
            outputPath: outputPath,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 音轨替换失败:", error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 调节音量
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {number} volumeLevel - 音量级别（0.5=50%, 1.0=100%, 2.0=200%）
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法
   */
  async adjustVolume(
    inputPath,
    outputPath,
    volumeLevel = 1.0,
    options = {},
    onProgress = null,
  ) {
    const { normalize = false } = options;

    console.log(`[Video Engine] 调节音量: ${volumeLevel}x`);

    return new Promise((resolve, reject) => {
      const audioFilters = [];

      // 音量归一化（先归一化，再调节音量）
      if (normalize) {
        audioFilters.push("loudnorm");
      }

      // 音量调节
      audioFilters.push(`volume=${volumeLevel}`);

      const command = ffmpeg(inputPath)
        .output(outputPath)
        .outputOptions(["-c:v copy"])
        .audioFilters(audioFilters);

      if (onProgress) {
        command.on("progress", (progress) => {
          const percent = progress.percent || 0;
          onProgress({
            percent: Math.round(percent),
            message: `正在调节音量: ${Math.round(percent)}%`,
          });
        });
      }

      command
        .on("end", () => {
          console.log("[Video Engine] 音量调节完成");
          resolve({
            success: true,
            outputPath: outputPath,
            volumeLevel: volumeLevel,
            normalized: normalize,
          });
        })
        .on("error", (error) => {
          console.error("[Video Engine] 音量调节失败:", error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * 使用预设样式添加字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} subtitlePath - 字幕文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {string} presetName - 预设名称 (default/cinema/minimal/bold)
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法
   */
  async addSubtitlesWithPreset(
    inputPath,
    subtitlePath,
    outputPath,
    presetName = "default",
    onProgress = null,
  ) {
    console.log(`[Video Engine] 应用字幕预设: ${presetName}`);

    const preset = this.subtitlePresets[presetName];
    if (!preset) {
      throw new Error(`不支持的字幕预设: ${presetName}`);
    }

    return await this.addSubtitles(
      inputPath,
      subtitlePath,
      outputPath,
      preset,
      onProgress,
    );
  }

  /**
   * 安全解析帧率字符串 (如 "30/1" 或 "24000/1001")
   * @param {string} frameRateStr - 帧率字符串
   * @returns {number} - 帧率数值
   */
  _parseFrameRate(frameRateStr) {
    if (!frameRateStr) return 0;

    // 处理分数格式如 "30/1" 或 "24000/1001"
    if (frameRateStr.includes("/")) {
      const [numerator, denominator] = frameRateStr.split("/").map(Number);
      if (denominator && !isNaN(numerator) && !isNaN(denominator)) {
        return numerator / denominator;
      }
    }

    // 尝试直接解析为数字
    const num = parseFloat(frameRateStr);
    return isNaN(num) ? 0 : num;
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
  getVideoEngine,
};
