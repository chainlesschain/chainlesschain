/**
 * 语音识别性能优化模块
 * 优化音频处理、缓存管理和识别速度
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 语音识别性能指标
 */
export interface SpeechMetrics {
  totalRecognitions: number;
  cacheHits: number;
  averageRecognitionTime: number;
  recognitionTimes: number[];
}

/**
 * 完整的语音识别性能指标（带计算字段）
 */
export interface SpeechMetricsWithStats extends SpeechMetrics {
  cacheHitRate: string;
  cacheSize: number;
  bufferPoolSize: number;
}

/**
 * 缓存条目
 */
export interface CacheEntry<T = string> {
  result: T;
  timestamp: number;
}

/**
 * 音频优化设置
 */
export interface AudioSettings {
  sampleRate: number;
  bitRate: number;
  channels: number;
  chunkSize: number;
}

/**
 * 批量识别任务
 */
export interface RecognitionTask {
  id: number;
  file: File | Blob;
}

/**
 * 批量识别结果
 */
export interface RecognitionResult {
  taskId: number;
  text?: string;
  error?: Error;
}

// ==================== 内部类型定义 ====================

/**
 * 网络连接信息
 */
interface NetworkConnectionInfo {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

/**
 * 扩展的 Navigator 接口
 */
interface ExtendedNavigator {
  connection?: NetworkConnectionInfo;
  mozConnection?: NetworkConnectionInfo;
  webkitConnection?: NetworkConnectionInfo;
  deviceMemory?: number;
  hardwareConcurrency: number;
}

/**
 * 语音识别接口
 */
interface SpeechRecognitionInterface {
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * 语音识别构造函数
 */
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInterface;
}

/**
 * 扩展的 Window 接口
 */
interface ExtendedWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

// ==================== 类实现 ====================

/**
 * 语音识别性能优化器
 */
class SpeechPerformanceOptimizer {
  // 音频缓冲池
  private audioBufferPool: Map<string, AudioBuffer>;
  private maxPoolSize: number;

  // 识别结果缓存
  private recognitionCache: Map<string, CacheEntry<string>>;
  private maxCacheSize: number;

  // 性能指标
  private metrics: SpeechMetrics;

  // 清理定时器ID
  private _cleanupIntervalId: ReturnType<typeof setInterval> | null;

  constructor() {
    this.audioBufferPool = new Map();
    this.maxPoolSize = 10;

    this.recognitionCache = new Map();
    this.maxCacheSize = 100;

    this.metrics = {
      totalRecognitions: 0,
      cacheHits: 0,
      averageRecognitionTime: 0,
      recognitionTimes: [],
    };

    this._cleanupIntervalId = null;
  }

  /**
   * 启动自动清理定时器
   */
  startAutoCleanup(interval: number = 600000): void {
    if (this._cleanupIntervalId) {
      clearInterval(this._cleanupIntervalId);
    }
    this._cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredCache();
    }, interval);
  }

  /**
   * 停止自动清理定时器
   */
  stopAutoCleanup(): void {
    if (this._cleanupIntervalId) {
      clearInterval(this._cleanupIntervalId);
      this._cleanupIntervalId = null;
    }
  }

  /**
   * 销毁实例，清理资源
   */
  destroy(): void {
    this.stopAutoCleanup();
    this.audioBufferPool.clear();
    this.recognitionCache.clear();
  }

  /**
   * 优化音频数据
   * 使用Web Audio API进行预处理
   */
  async optimizeAudioData(audioBlob: Blob): Promise<Float32Array | Blob> {
    const startTime = performance.now();

    try {
      // 创建AudioContext
      const extWindow = window as unknown as ExtendedWindow;
      const AudioContextClass = extWindow.AudioContext || extWindow.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext not supported');
      }
      const audioContext = new AudioContextClass();

      // 解码音频数据
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 降采样到16kHz（Whisper标准）
      const targetSampleRate = 16000;
      const resampledBuffer = this.resampleAudio(audioBuffer, targetSampleRate);

      // 应用降噪滤波器
      const filteredBuffer = this.applyNoiseReduction(resampledBuffer);

      // 归一化音量
      const normalizedBuffer = this.normalizeVolume(filteredBuffer);

      const processingTime = performance.now() - startTime;
      logger.info(
        `[SpeechOptimizer] 音频优化完成: ${processingTime.toFixed(2)}ms`
      );

      return normalizedBuffer;
    } catch (error) {
      logger.error('[SpeechOptimizer] 音频优化失败:', error as Error);
      return audioBlob;
    }
  }

  /**
   * 重采样音频
   */
  resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Float32Array {
    const sourceSampleRate = audioBuffer.sampleRate;
    if (sourceSampleRate === targetSampleRate) {
      return audioBuffer.getChannelData(0);
    }

    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    const result = new Float32Array(newLength);
    const sourceData = audioBuffer.getChannelData(0);

    for (let i = 0; i < newLength; i++) {
      const sourceIndex = Math.floor(i * ratio);
      result[i] = sourceData[sourceIndex];
    }

    return result;
  }

  /**
   * 应用降噪
   * 使用简单的高通滤波器去除低频噪声
   */
  applyNoiseReduction(audioData: Float32Array): Float32Array {
    const filtered = new Float32Array(audioData.length);
    const alpha = 0.95; // 高通滤波器系数

    filtered[0] = audioData[0];
    for (let i = 1; i < audioData.length; i++) {
      filtered[i] = alpha * (filtered[i - 1] + audioData[i] - audioData[i - 1]);
    }

    return filtered;
  }

  /**
   * 归一化音量
   */
  normalizeVolume(audioData: Float32Array): Float32Array {
    // 找到最大振幅
    let maxAmplitude = 0;
    for (let i = 0; i < audioData.length; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(audioData[i]));
    }

    // 归一化到0.9（留一些余量）
    if (maxAmplitude > 0) {
      const normalized = new Float32Array(audioData.length);
      const scale = 0.9 / maxAmplitude;
      for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * scale;
      }
      return normalized;
    }

    return audioData;
  }

  /**
   * 检查识别缓存
   */
  checkCache(audioHash: string): CacheEntry<string> | null {
    if (this.recognitionCache.has(audioHash)) {
      this.metrics.cacheHits++;
      return this.recognitionCache.get(audioHash) || null;
    }
    return null;
  }

  /**
   * 保存到缓存
   */
  saveToCache(audioHash: string, result: string): void {
    // 限制缓存大小
    if (this.recognitionCache.size >= this.maxCacheSize) {
      const firstKey = this.recognitionCache.keys().next().value;
      if (firstKey !== undefined) {
        this.recognitionCache.delete(firstKey);
      }
    }

    this.recognitionCache.set(audioHash, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * 计算音频哈希（用于缓存）
   */
  async calculateAudioHash(audioData: ArrayBuffer | Float32Array): Promise<string> {
    // 使用SubtleCrypto API计算SHA-256哈希
    const buffer = audioData instanceof Float32Array ? audioData.buffer : audioData;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 批量识别优化
   * 使用Web Worker并行处理
   */
  async batchRecognize(audioFiles: Array<File | Blob>): Promise<RecognitionResult[]> {
    const startTime = performance.now();

    // 创建Worker池
    const workerPool = this.createWorkerPool(navigator.hardwareConcurrency || 4);

    // 分配任务
    const tasks: RecognitionTask[] = audioFiles.map((file, index) => ({
      id: index,
      file,
    }));

    // 并行处理
    const results = await Promise.all(
      tasks.map((task) => this.processWithWorker(workerPool, task))
    );

    // 清理Worker
    workerPool.forEach((worker) => worker.terminate());

    const totalTime = performance.now() - startTime;
    logger.info(`[SpeechOptimizer] 批量识别完成: ${totalTime.toFixed(2)}ms`);

    return results;
  }

  /**
   * 创建Worker池
   */
  createWorkerPool(size: number): Worker[] {
    const workers: Worker[] = [];
    for (let i = 0; i < size; i++) {
      // 注意：实际使用时需要创建真实的Worker文件
      // workers.push(new Worker('./speech-worker.js'));
    }
    return workers;
  }

  /**
   * 使用Worker处理任务
   */
  async processWithWorker(workerPool: Worker[], task: RecognitionTask): Promise<RecognitionResult> {
    // 选择空闲的Worker
    const worker = workerPool[task.id % workerPool.length];

    if (!worker) {
      return { taskId: task.id, error: new Error('No worker available') };
    }

    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        resolve({ taskId: task.id, text: e.data });
      };

      worker.onerror = (error: ErrorEvent) => {
        reject({ taskId: task.id, error: new Error(error.message) });
      };

      worker.postMessage(task);
    });
  }

  /**
   * 自适应质量调整
   * 根据网络状况和设备性能动态调整
   */
  getOptimalSettings(): AudioSettings {
    const extNavigator = navigator as unknown as ExtendedNavigator;
    const connection =
      extNavigator.connection ||
      extNavigator.mozConnection ||
      extNavigator.webkitConnection;
    const memory = extNavigator.deviceMemory || 4; // GB

    const settings: AudioSettings = {
      sampleRate: 16000,
      bitRate: 128000,
      channels: 1,
      chunkSize: 4096,
    };

    // 根据网络状况调整
    if (connection) {
      const effectiveType = connection.effectiveType;

      if (effectiveType === '4g') {
        settings.bitRate = 192000;
        settings.chunkSize = 8192;
      } else if (effectiveType === '3g') {
        settings.bitRate = 96000;
        settings.chunkSize = 2048;
      } else if (effectiveType === '2g' || effectiveType === 'slow-2g') {
        settings.bitRate = 64000;
        settings.chunkSize = 1024;
      }
    }

    // 根据设备内存调整
    if (memory < 2) {
      settings.chunkSize = Math.min(settings.chunkSize, 2048);
    } else if (memory >= 8) {
      settings.chunkSize = Math.max(settings.chunkSize, 8192);
    }

    logger.info('[SpeechOptimizer] 优化设置:', settings);
    return settings;
  }

  /**
   * 预加载模型
   * 提前加载识别模型以减少首次识别延迟
   */
  async preloadModels(): Promise<void> {
    logger.info('[SpeechOptimizer] 预加载识别模型...');

    try {
      // 创建一个临时的SpeechRecognition实例
      const extWindow = window as unknown as ExtendedWindow;
      const SpeechRecognitionClass =
        extWindow.SpeechRecognition || extWindow.webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        const recognition = new SpeechRecognitionClass();
        recognition.lang = 'zh-CN';

        // 启动并立即停止以触发模型加载
        recognition.start();
        setTimeout(() => recognition.stop(), 100);

        logger.info('[SpeechOptimizer] 模型预加载完成');
      }
    } catch (error) {
      logger.warn('[SpeechOptimizer] 模型预加载失败:', error as Error);
    }
  }

  /**
   * 获取性能指标
   */
  getMetrics(): SpeechMetricsWithStats {
    const cacheHitRate =
      this.metrics.totalRecognitions > 0
        ? (
            (this.metrics.cacheHits / this.metrics.totalRecognitions) *
            100
          ).toFixed(2)
        : '0';

    return {
      ...this.metrics,
      cacheHitRate: `${cacheHitRate}%`,
      cacheSize: this.recognitionCache.size,
      bufferPoolSize: this.audioBufferPool.size,
    };
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.recognitionCache.clear();
    this.audioBufferPool.clear();
    logger.info('[SpeechOptimizer] 缓存已清理');
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(maxAge: number = 3600000): void {
    // 默认1小时
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.recognitionCache.entries()) {
      if (now - value.timestamp > maxAge) {
        this.recognitionCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[SpeechOptimizer] 清理了 ${cleaned} 个过期缓存项`);
    }
  }

  /**
   * 记录识别时间
   */
  recordRecognitionTime(time: number): void {
    this.metrics.totalRecognitions++;
    this.metrics.recognitionTimes.push(time);

    // 只保留最近100次的记录
    if (this.metrics.recognitionTimes.length > 100) {
      this.metrics.recognitionTimes.shift();
    }

    // 计算平均时间
    const sum = this.metrics.recognitionTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageRecognitionTime =
      sum / this.metrics.recognitionTimes.length;
  }
}

// 导出单例
const speechOptimizer = new SpeechPerformanceOptimizer();

// 启动自动清理过期缓存（每10分钟）
speechOptimizer.startAutoCleanup(600000);

export { SpeechPerformanceOptimizer };
export default speechOptimizer;
