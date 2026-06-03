/**
 * ScreenRecorder - 屏幕录制功能
 *
 * 支持：
 * - 浏览器页面录制
 * - 桌面屏幕录制
 * - 截图序列
 * - 视频导出
 *
 * @module browser/actions/screen-recorder
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * 录制状态
 */
const RecordingState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  STOPPED: 'stopped'
};

/**
 * 录制模式
 */
const RecordingMode = {
  SCREENSHOT_SEQUENCE: 'screenshot_sequence',  // 截图序列
  VIDEO: 'video'  // 视频录制（需要 ffmpeg）
};

class ScreenRecorder extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      mode: config.mode || RecordingMode.SCREENSHOT_SEQUENCE,
      fps: config.fps || 2,  // 每秒帧数
      quality: config.quality || 80,
      outputDir: config.outputDir || path.join(process.cwd(), '.chainlesschain', 'recordings'),
      maxDuration: config.maxDuration || 300000,  // 最大录制时长 5分钟
      includeMouseCursor: config.includeMouseCursor || true,
      ...config
    };

    // 录制状态
    this.state = RecordingState.IDLE;
    this.currentRecording = null;
    this.frames = [];
    this.recordingTimer = null;
    this.startTime = null;
    this.pausedDuration = 0;
    this.pauseStartTime = null;
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 开始录制
   * @param {string} targetId - 标签页 ID（浏览器录制）或 null（桌面录制）
   * @param {Object} options - 录制选项
   * @returns {Promise<Object>}
   */
  async startRecording(targetId = null, options = {}) {
    if (this.state === RecordingState.RECORDING) {
      throw new Error('Recording already in progress');
    }

    const recordingId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建输出目录
    const outputDir = path.join(this.config.outputDir, recordingId);
    await fs.mkdir(outputDir, { recursive: true });

    this.currentRecording = {
      id: recordingId,
      targetId,
      outputDir,
      startTime: new Date().toISOString(),
      options: { ...this.config, ...options },
      frameCount: 0,
      duration: 0
    };

    this.frames = [];
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this.state = RecordingState.RECORDING;

    // 开始截图定时器
    const interval = 1000 / this.currentRecording.options.fps;
    this.recordingTimer = setInterval(() => this._captureFrame(), interval);

    // 设置最大录制时长
    if (this.currentRecording.options.maxDuration) {
      setTimeout(() => {
        if (this.state === RecordingState.RECORDING) {
          this.stopRecording();
        }
      }, this.currentRecording.options.maxDuration);
    }

    this.emit('recordingStarted', {
      id: recordingId,
      targetId,
      startTime: this.currentRecording.startTime
    });

    return {
      success: true,
      recordingId,
      outputDir
    };
  }

  /**
   * 暂停录制
   * @returns {Object}
   */
  pauseRecording() {
    if (this.state !== RecordingState.RECORDING) {
      throw new Error('No active recording to pause');
    }

    this.state = RecordingState.PAUSED;
    this.pauseStartTime = Date.now();

    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    this.emit('recordingPaused', {
      id: this.currentRecording.id,
      frameCount: this.currentRecording.frameCount
    });

    return {
      success: true,
      state: this.state
    };
  }

  /**
   * 恢复录制
   * @returns {Object}
   */
  resumeRecording() {
    if (this.state !== RecordingState.PAUSED) {
      throw new Error('Recording is not paused');
    }

    // 计算暂停时长
    if (this.pauseStartTime) {
      this.pausedDuration += Date.now() - this.pauseStartTime;
      this.pauseStartTime = null;
    }

    this.state = RecordingState.RECORDING;

    // 恢复截图定时器
    const interval = 1000 / this.currentRecording.options.fps;
    this.recordingTimer = setInterval(() => this._captureFrame(), interval);

    this.emit('recordingResumed', {
      id: this.currentRecording.id
    });

    return {
      success: true,
      state: this.state
    };
  }

  /**
   * 停止录制
   * @returns {Promise<Object>}
   */
  async stopRecording() {
    if (this.state === RecordingState.IDLE || this.state === RecordingState.STOPPED) {
      throw new Error('No active recording to stop');
    }

    // 停止定时器
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    this.state = RecordingState.STOPPED;

    // 计算总时长
    const endTime = Date.now();
    const totalDuration = endTime - this.startTime - this.pausedDuration;
    this.currentRecording.duration = totalDuration;
    this.currentRecording.endTime = new Date().toISOString();

    // 保存元数据
    const metadata = {
      id: this.currentRecording.id,
      targetId: this.currentRecording.targetId,
      startTime: this.currentRecording.startTime,
      endTime: this.currentRecording.endTime,
      duration: totalDuration,
      frameCount: this.currentRecording.frameCount,
      fps: this.currentRecording.options.fps,
      frames: this.frames.map(f => ({
        index: f.index,
        timestamp: f.timestamp,
        filename: f.filename
      }))
    };

    await fs.writeFile(
      path.join(this.currentRecording.outputDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    const result = {
      success: true,
      recordingId: this.currentRecording.id,
      outputDir: this.currentRecording.outputDir,
      duration: totalDuration,
      frameCount: this.currentRecording.frameCount,
      metadata
    };

    this.emit('recordingStopped', result);

    // 重置状态
    const recording = this.currentRecording;
    this.currentRecording = null;
    this.frames = [];
    this.state = RecordingState.IDLE;

    return result;
  }

  /**
   * 捕获帧
   * @private
   */
  async _captureFrame() {
    if (this.state !== RecordingState.RECORDING || !this.currentRecording) {
      return;
    }

    try {
      const frameIndex = this.currentRecording.frameCount;
      const timestamp = Date.now() - this.startTime - this.pausedDuration;
      const filename = `frame_${String(frameIndex).padStart(6, '0')}.jpg`;

      let buffer;

      if (this.currentRecording.targetId && this.browserEngine) {
        // 浏览器页面截图
        buffer = await this.browserEngine.screenshot(this.currentRecording.targetId, {
          type: 'jpeg',
          quality: this.currentRecording.options.quality
        });
      } else {
        // 桌面截图
        const { DesktopAction } = require('./desktop-action');
        const desktop = new DesktopAction();
        const result = await desktop.captureScreen({
          quality: this.currentRecording.options.quality
        });
        buffer = Buffer.from(result.base64, 'base64');
      }

      // 保存帧
      const framePath = path.join(this.currentRecording.outputDir, filename);
      await fs.writeFile(framePath, buffer);

      const frame = {
        index: frameIndex,
        timestamp,
        filename,
        path: framePath,
        size: buffer.length
      };

      this.frames.push(frame);
      this.currentRecording.frameCount++;

      this.emit('frameCaptured', frame);

    } catch (error) {
      this.emit('frameError', { error: error.message });
    }
  }

  /**
   * 获取录制状态
   * @returns {Object}
   */
  getStatus() {
    const elapsed = this.state === RecordingState.RECORDING && this.startTime
      ? Date.now() - this.startTime - this.pausedDuration
      : 0;

    return {
      state: this.state,
      recordingId: this.currentRecording?.id,
      frameCount: this.currentRecording?.frameCount || 0,
      elapsed,
      targetId: this.currentRecording?.targetId,
      outputDir: this.currentRecording?.outputDir
    };
  }

  /**
   * 获取录制列表
   * @returns {Promise<Array>}
   */
  async listRecordings() {
    try {
      const dirs = await fs.readdir(this.config.outputDir);
      const recordings = [];

      for (const dir of dirs) {
        if (dir.startsWith('rec_')) {
          try {
            const metadataPath = path.join(this.config.outputDir, dir, 'metadata.json');
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
            recordings.push(metadata);
          } catch (e) {
            // 跳过无效录制
          }
        }
      }

      return recordings.sort((a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * 获取录制详情
   * @param {string} recordingId - 录制 ID
   * @returns {Promise<Object>}
   */
  async getRecording(recordingId) {
    const metadataPath = path.join(this.config.outputDir, recordingId, 'metadata.json');

    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      return {
        success: true,
        ...metadata
      };
    } catch (error) {
      return {
        success: false,
        error: `Recording not found: ${recordingId}`
      };
    }
  }

  /**
   * 删除录制
   * @param {string} recordingId - 录制 ID
   * @returns {Promise<Object>}
   */
  async deleteRecording(recordingId) {
    const recordingDir = path.join(this.config.outputDir, recordingId);

    try {
      await fs.rm(recordingDir, { recursive: true, force: true });

      this.emit('recordingDeleted', { recordingId });

      return {
        success: true,
        recordingId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 导出为 GIF（需要外部工具支持）
   * @param {string} recordingId - 录制 ID
   * @param {Object} options - 导出选项
   * @returns {Promise<Object>}
   */
  async exportToGif(recordingId, options = {}) {
    const recording = await this.getRecording(recordingId);
    if (!recording.success) {
      return recording;
    }

    // 这里需要使用外部工具如 gifski 或 ffmpeg
    // 简单实现返回帧列表供前端处理
    const framesDir = path.join(this.config.outputDir, recordingId);
    const frames = [];

    for (const frame of recording.frames) {
      const framePath = path.join(framesDir, frame.filename);
      try {
        const buffer = await fs.readFile(framePath);
        frames.push({
          ...frame,
          data: buffer.toString('base64')
        });
      } catch (e) {
        // 跳过无法读取的帧
      }
    }

    return {
      success: true,
      recordingId,
      frames,
      fps: recording.fps,
      duration: recording.duration
    };
  }

  /**
   * 获取帧图片
   * @param {string} recordingId - 录制 ID
   * @param {number} frameIndex - 帧索引
   * @returns {Promise<Object>}
   */
  async getFrame(recordingId, frameIndex) {
    const filename = `frame_${String(frameIndex).padStart(6, '0')}.jpg`;
    const framePath = path.join(this.config.outputDir, recordingId, filename);

    try {
      const buffer = await fs.readFile(framePath);
      return {
        success: true,
        frameIndex,
        data: buffer.toString('base64'),
        type: 'image/jpeg'
      };
    } catch (error) {
      return {
        success: false,
        error: `Frame not found: ${frameIndex}`
      };
    }
  }
}

// 单例
let screenRecorderInstance = null;

function getScreenRecorder(browserEngine, config) {
  if (!screenRecorderInstance) {
    screenRecorderInstance = new ScreenRecorder(browserEngine, config);
  } else if (browserEngine) {
    screenRecorderInstance.setBrowserEngine(browserEngine);
  }
  return screenRecorderInstance;
}

module.exports = {
  ScreenRecorder,
  RecordingState,
  RecordingMode,
  getScreenRecorder
};
