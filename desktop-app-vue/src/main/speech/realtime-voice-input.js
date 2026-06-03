/**
 * 实时语音输入模块
 *
 * 提供麦克风实时录音和转录功能
 * 支持流式识别和即时反馈
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { Readable } = require("stream");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

/**
 * 实时语音输入类
 */
class RealtimeVoiceInput extends EventEmitter {
  constructor(speechRecognizer, config = {}) {
    super();

    this.recognizer = speechRecognizer;
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitsPerSample: config.bitsPerSample || 16,
      chunkDuration: config.chunkDuration || 3000, // 3秒一个chunk
      silenceThreshold: config.silenceThreshold || 0.01,
      silenceDuration: config.silenceDuration || 1000, // 1秒静音判定为停止
      maxRecordingTime: config.maxRecordingTime || 300000, // 最长5分钟
      ...config,
    };

    // 状态
    this.isRecording = false;
    this.isPaused = false;
    this.audioChunks = [];
    this.currentChunk = [];
    this.recordingStartTime = null;
    this.lastSoundTime = null;

    // 识别结果
    this.partialResults = [];
    this.finalResults = [];

    // 定时器
    this.chunkTimer = null;
    this.silenceTimer = null;
    this.maxTimeTimer = null;
  }

  /**
   * 开始录音
   * @param {Object} options - 录音选项
   * @returns {Promise<void>}
   */
  async startRecording(options = {}) {
    if (this.isRecording) {
      throw new Error("已经在录音中");
    }

    logger.info("[RealtimeVoiceInput] 开始实时录音...");

    this.isRecording = true;
    this.isPaused = false;
    this.audioChunks = [];
    this.currentChunk = [];
    this.partialResults = [];
    this.finalResults = [];
    this.recordingStartTime = Date.now();
    this.lastSoundTime = Date.now();

    // 发送开始事件
    this.emit("recording:started", {
      timestamp: this.recordingStartTime,
      config: this.config,
    });

    // 启动定期处理
    this.startChunkProcessing();

    // 设置最大录音时间限制
    this.maxTimeTimer = setTimeout(() => {
      logger.info("[RealtimeVoiceInput] 达到最大录音时间，自动停止");
      this.stopRecording();
    }, this.config.maxRecordingTime);
  }

  /**
   * 添加音频数据
   * @param {Buffer} audioData - PCM音频数据
   */
  addAudioData(audioData) {
    if (!this.isRecording || this.isPaused) {
      return;
    }

    // 添加到当前chunk
    this.currentChunk.push(audioData);

    // 调试日志：每10次打印一次接收状态
    if (this.currentChunk.length % 10 === 1) {
      logger.info(
        `[RealtimeVoiceInput] 接收音频数据: ${audioData.length} bytes, 当前chunk数量: ${this.currentChunk.length}`,
      );
    }

    // 检测音量（简单的能量计算）
    const volume = this.calculateVolume(audioData);

    if (volume > this.config.silenceThreshold) {
      this.lastSoundTime = Date.now();

      // 取消静音定时器
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else {
      // 检测静音
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          logger.info("[RealtimeVoiceInput] 检测到静音，准备停止");
          this.emit("silence:detected");

          // 可以选择自动停止
          if (this.config.autoStopOnSilence) {
            this.stopRecording();
          }
        }, this.config.silenceDuration);
      }
    }

    // 发送音量事件
    this.emit("audio:volume", { volume, timestamp: Date.now() });
  }

  /**
   * 启动chunk处理
   */
  startChunkProcessing() {
    this.chunkTimer = setInterval(async () => {
      if (this.currentChunk.length > 0 && !this.isPaused) {
        await this.processCurrentChunk();
      }
    }, this.config.chunkDuration);
  }

  /**
   * 处理当前chunk
   */
  async processCurrentChunk() {
    if (this.currentChunk.length === 0) {
      return;
    }

    // 合并chunk数据
    const chunkData = Buffer.concat(this.currentChunk);
    this.audioChunks.push(chunkData);

    logger.info(
      `[RealtimeVoiceInput] 处理chunk ${this.audioChunks.length}, 大小: ${chunkData.length} bytes`,
    );

    // 清空当前chunk
    const processedChunk = this.currentChunk;
    this.currentChunk = [];

    let tempWavFile = null;

    try {
      // 发送处理事件
      this.emit("chunk:processing", {
        chunkIndex: this.audioChunks.length - 1,
        size: chunkData.length,
      });

      // 检查数据是否有效（至少需要一些音频数据）
      if (chunkData.length < 1000) {
        logger.info("[RealtimeVoiceInput] Chunk 数据太小，跳过识别");
        return;
      }

      // 将 PCM 数据保存为临时 WAV 文件
      tempWavFile = await this.savePCMAsWav(chunkData);
      logger.info(`[RealtimeVoiceInput] 创建临时 WAV 文件: ${tempWavFile}`);

      // 转录当前chunk（传递文件路径而不是 Buffer）
      logger.info(`[RealtimeVoiceInput] 发送到 Whisper 识别: ${tempWavFile}`);
      const result = await this.recognizer.recognize(tempWavFile, {
        language: this.config.language || "zh",
      });
      logger.info(
        `[RealtimeVoiceInput] Whisper 返回结果:`,
        JSON.stringify(result),
      );

      if (result && result.text) {
        // 部分结果
        this.partialResults.push({
          chunkIndex: this.audioChunks.length - 1,
          text: result.text,
          confidence: result.confidence || 0,
          timestamp: Date.now(),
        });

        // 发送部分结果事件
        this.emit("transcript:partial", {
          text: result.text,
          chunkIndex: this.audioChunks.length - 1,
          confidence: result.confidence,
          allText: this.getFullTranscript(),
        });
      }

      // 发送完成事件
      this.emit("chunk:processed", {
        chunkIndex: this.audioChunks.length - 1,
        text: result?.text || "",
        success: true,
      });
    } catch (error) {
      logger.error("[RealtimeVoiceInput] Chunk处理失败:", error);

      this.emit("chunk:error", {
        chunkIndex: this.audioChunks.length - 1,
        error: error.message,
      });

      // 将chunk重新加入队列（或丢弃）
      if (this.config.retryOnError) {
        this.currentChunk = processedChunk;
      }
    } finally {
      // 清理临时文件
      if (tempWavFile) {
        await this.cleanupTempFile(tempWavFile);
      }
    }
  }

  /**
   * 暂停录音
   */
  pause() {
    if (!this.isRecording || this.isPaused) {
      return;
    }

    logger.info("[RealtimeVoiceInput] 暂停录音");
    this.isPaused = true;

    this.emit("recording:paused", {
      timestamp: Date.now(),
      duration: Date.now() - this.recordingStartTime,
    });
  }

  /**
   * 恢复录音
   */
  resume() {
    if (!this.isRecording || !this.isPaused) {
      return;
    }

    logger.info("[RealtimeVoiceInput] 恢复录音");
    this.isPaused = false;

    this.emit("recording:resumed", {
      timestamp: Date.now(),
    });
  }

  /**
   * 停止录音
   * @returns {Promise<Object>} 最终结果
   */
  async stopRecording() {
    if (!this.isRecording) {
      return null;
    }

    logger.info("[RealtimeVoiceInput] 停止录音");

    // 清理定时器
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.maxTimeTimer) {
      clearTimeout(this.maxTimeTimer);
      this.maxTimeTimer = null;
    }

    // 处理剩余的chunk
    if (this.currentChunk.length > 0) {
      await this.processCurrentChunk();
    }

    this.isRecording = false;
    this.isPaused = false;

    const duration = Date.now() - this.recordingStartTime;
    const fullTranscript = this.getFullTranscript();

    // 合并所有音频数据
    const fullAudio =
      this.audioChunks.length > 0
        ? Buffer.concat(this.audioChunks)
        : Buffer.alloc(0);

    const result = {
      transcript: fullTranscript,
      partialResults: this.partialResults,
      finalResults: this.finalResults,
      duration: duration,
      audioData: fullAudio,
      chunks: this.audioChunks.length,
      timestamp: Date.now(),
    };

    // 发送停止事件
    this.emit("recording:stopped", result);

    return result;
  }

  /**
   * 取消录音
   */
  cancel() {
    logger.info("[RealtimeVoiceInput] 取消录音");

    // 清理所有状态
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.maxTimeTimer) {
      clearTimeout(this.maxTimeTimer);
      this.maxTimeTimer = null;
    }

    this.isRecording = false;
    this.isPaused = false;
    this.audioChunks = [];
    this.currentChunk = [];
    this.partialResults = [];
    this.finalResults = [];

    this.emit("recording:cancelled", {
      timestamp: Date.now(),
    });
  }

  /**
   * 获取完整转录文本
   * @returns {string}
   */
  getFullTranscript() {
    return this.partialResults
      .map((r) => r.text)
      .filter((text) => text && text.trim())
      .join(" ");
  }

  /**
   * 将 PCM Buffer 保存为 WAV 文件
   * @param {Buffer} pcmData - 16-bit PCM 数据
   * @returns {Promise<string>} 临时 WAV 文件路径
   */
  async savePCMAsWav(pcmData) {
    const sampleRate = this.config.sampleRate;
    const channels = this.config.channels;
    const bitsPerSample = this.config.bitsPerSample;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    // 创建 WAV 文件头 (44 bytes)
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write("RIFF", 0); // ChunkID
    header.writeUInt32LE(fileSize, 4); // ChunkSize
    header.write("WAVE", 8); // Format

    // fmt sub-chunk
    header.write("fmt ", 12); // Subchunk1ID
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, 22); // NumChannels
    header.writeUInt32LE(sampleRate, 24); // SampleRate
    header.writeUInt32LE(byteRate, 28); // ByteRate
    header.writeUInt16LE(blockAlign, 32); // BlockAlign
    header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

    // data sub-chunk
    header.write("data", 36); // Subchunk2ID
    header.writeUInt32LE(dataSize, 40); // Subchunk2Size

    // 合并头和数据
    const wavBuffer = Buffer.concat([header, pcmData]);

    // 保存到临时文件
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `realtime_${uuidv4()}.wav`);

    await fs.writeFile(tempFile, wavBuffer);

    return tempFile;
  }

  /**
   * 删除临时文件
   * @param {string} filePath - 文件路径
   */
  async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logger.warn("[RealtimeVoiceInput] 清理临时文件失败:", error.message);
    }
  }

  /**
   * 计算音频音量
   * @param {Buffer} audioData - PCM数据
   * @returns {number} 音量 (0-1)
   */
  calculateVolume(audioData) {
    if (!audioData || audioData.length === 0) {
      return 0;
    }

    // 简单的RMS计算
    let sum = 0;
    const samples = audioData.length / 2; // 16-bit = 2 bytes per sample

    for (let i = 0; i < audioData.length; i += 2) {
      const sample = audioData.readInt16LE(i);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / samples);
    const normalized = rms / 32768; // 16-bit max value

    return Math.min(1, normalized);
  }

  /**
   * 获取录音状态
   * @returns {Object}
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      duration: this.isRecording ? Date.now() - this.recordingStartTime : 0,
      chunks: this.audioChunks.length,
      transcriptLength: this.getFullTranscript().length,
    };
  }
}

module.exports = RealtimeVoiceInput;
