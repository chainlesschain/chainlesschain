/**
 * 实时语音输入模块
 *
 * 提供麦克风实时录音和转录功能
 * 支持流式识别和即时反馈
 */

const { EventEmitter } = require('events');
const { Readable } = require('stream');

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
      ...config
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
      throw new Error('已经在录音中');
    }

    console.log('[RealtimeVoiceInput] 开始实时录音...');

    this.isRecording = true;
    this.isPaused = false;
    this.audioChunks = [];
    this.currentChunk = [];
    this.partialResults = [];
    this.finalResults = [];
    this.recordingStartTime = Date.now();
    this.lastSoundTime = Date.now();

    // 发送开始事件
    this.emit('recording:started', {
      timestamp: this.recordingStartTime,
      config: this.config
    });

    // 启动定期处理
    this.startChunkProcessing();

    // 设置最大录音时间限制
    this.maxTimeTimer = setTimeout(() => {
      console.log('[RealtimeVoiceInput] 达到最大录音时间，自动停止');
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
          console.log('[RealtimeVoiceInput] 检测到静音，准备停止');
          this.emit('silence:detected');

          // 可以选择自动停止
          if (this.config.autoStopOnSilence) {
            this.stopRecording();
          }
        }, this.config.silenceDuration);
      }
    }

    // 发送音量事件
    this.emit('audio:volume', { volume, timestamp: Date.now() });
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

    console.log(`[RealtimeVoiceInput] 处理chunk ${this.audioChunks.length}, 大小: ${chunkData.length} bytes`);

    // 清空当前chunk
    const processedChunk = this.currentChunk;
    this.currentChunk = [];

    try {
      // 发送处理事件
      this.emit('chunk:processing', {
        chunkIndex: this.audioChunks.length - 1,
        size: chunkData.length
      });

      // 转录当前chunk
      const result = await this.recognizer.recognize(chunkData, {
        language: this.config.language || 'zh',
        format: 'wav',
        sampleRate: this.config.sampleRate,
        streaming: true
      });

      if (result && result.text) {
        // 部分结果
        this.partialResults.push({
          chunkIndex: this.audioChunks.length - 1,
          text: result.text,
          confidence: result.confidence || 0,
          timestamp: Date.now()
        });

        // 发送部分结果事件
        this.emit('transcript:partial', {
          text: result.text,
          chunkIndex: this.audioChunks.length - 1,
          confidence: result.confidence,
          allText: this.getFullTranscript()
        });
      }

      // 发送完成事件
      this.emit('chunk:processed', {
        chunkIndex: this.audioChunks.length - 1,
        text: result?.text || '',
        success: true
      });

    } catch (error) {
      console.error('[RealtimeVoiceInput] Chunk处理失败:', error);

      this.emit('chunk:error', {
        chunkIndex: this.audioChunks.length - 1,
        error: error.message
      });

      // 将chunk重新加入队列（或丢弃）
      if (this.config.retryOnError) {
        this.currentChunk = processedChunk;
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

    console.log('[RealtimeVoiceInput] 暂停录音');
    this.isPaused = true;

    this.emit('recording:paused', {
      timestamp: Date.now(),
      duration: Date.now() - this.recordingStartTime
    });
  }

  /**
   * 恢复录音
   */
  resume() {
    if (!this.isRecording || !this.isPaused) {
      return;
    }

    console.log('[RealtimeVoiceInput] 恢复录音');
    this.isPaused = false;

    this.emit('recording:resumed', {
      timestamp: Date.now()
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

    console.log('[RealtimeVoiceInput] 停止录音');

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
    const fullAudio = this.audioChunks.length > 0
      ? Buffer.concat(this.audioChunks)
      : Buffer.alloc(0);

    const result = {
      transcript: fullTranscript,
      partialResults: this.partialResults,
      finalResults: this.finalResults,
      duration: duration,
      audioData: fullAudio,
      chunks: this.audioChunks.length,
      timestamp: Date.now()
    };

    // 发送停止事件
    this.emit('recording:stopped', result);

    return result;
  }

  /**
   * 取消录音
   */
  cancel() {
    console.log('[RealtimeVoiceInput] 取消录音');

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

    this.emit('recording:cancelled', {
      timestamp: Date.now()
    });
  }

  /**
   * 获取完整转录文本
   * @returns {string}
   */
  getFullTranscript() {
    return this.partialResults
      .map(r => r.text)
      .filter(text => text && text.trim())
      .join(' ');
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
      transcriptLength: this.getFullTranscript().length
    };
  }
}

module.exports = RealtimeVoiceInput;
