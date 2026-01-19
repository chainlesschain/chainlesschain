/**
 * 语音识别性能优化模块
 * 优化音频处理、缓存管理和识别速度
 */

class SpeechPerformanceOptimizer {
  constructor() {
    // 音频缓冲池
    this.audioBufferPool = new Map();
    this.maxPoolSize = 10;

    // 识别结果缓存
    this.recognitionCache = new Map();
    this.maxCacheSize = 100;

    // 性能指标
    this.metrics = {
      totalRecognitions: 0,
      cacheHits: 0,
      averageRecognitionTime: 0,
      recognitionTimes: [],
    };
  }

  /**
   * 优化音频数据
   * 使用Web Audio API进行预处理
   */
  async optimizeAudioData(audioBlob) {
    const startTime = performance.now();

    try {
      // 创建AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // 解码音频数据
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 降采样到16kHz（Whisper标准）
      const targetSampleRate = 16000;
      const resampledBuffer = this.resampleAudio(
        audioBuffer,
        targetSampleRate
      );

      // 应用降噪滤波器
      const filteredBuffer = this.applyNoiseReduction(resampledBuffer);

      // 归一化音量
      const normalizedBuffer = this.normalizeVolume(filteredBuffer);

      const processingTime = performance.now() - startTime;
      console.log(`[SpeechOptimizer] 音频优化完成: ${processingTime.toFixed(2)}ms`);

      return normalizedBuffer;
    } catch (error) {
      console.error('[SpeechOptimizer] 音频优化失败:', error);
      return audioBlob;
    }
  }

  /**
   * 重采样音频
   */
  resampleAudio(audioBuffer, targetSampleRate) {
    const sourceSampleRate = audioBuffer.sampleRate;
    if (sourceSampleRate === targetSampleRate) {
      return audioBuffer;
    }

    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const sourceIndex = Math.floor(i * ratio);
      result[i] = audioBuffer.getChannelData(0)[sourceIndex];
    }

    return result;
  }

  /**
   * 应用降噪
   * 使用简单的高通滤波器去除低频噪声
   */
  applyNoiseReduction(audioData) {
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
  normalizeVolume(audioData) {
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
  checkCache(audioHash) {
    if (this.recognitionCache.has(audioHash)) {
      this.metrics.cacheHits++;
      return this.recognitionCache.get(audioHash);
    }
    return null;
  }

  /**
   * 保存到缓存
   */
  saveToCache(audioHash, result) {
    // 限制缓存大小
    if (this.recognitionCache.size >= this.maxCacheSize) {
      const firstKey = this.recognitionCache.keys().next().value;
      this.recognitionCache.delete(firstKey);
    }

    this.recognitionCache.set(audioHash, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * 计算音频哈希（用于缓存）
   */
  async calculateAudioHash(audioData) {
    // 使用SubtleCrypto API计算SHA-256哈希
    const buffer = audioData.buffer || audioData;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 批量识别优化
   * 使用Web Worker并行处理
   */
  async batchRecognize(audioFiles) {
    const startTime = performance.now();

    // 创建Worker池
    const workerPool = this.createWorkerPool(navigator.hardwareConcurrency || 4);

    // 分配任务
    const tasks = audioFiles.map((file, index) => ({
      id: index,
      file,
    }));

    // 并行处理
    const results = await Promise.all(
      tasks.map(task => this.processWithWorker(workerPool, task))
    );

    // 清理Worker
    workerPool.forEach(worker => worker.terminate());

    const totalTime = performance.now() - startTime;
    console.log(`[SpeechOptimizer] 批量识别完成: ${totalTime.toFixed(2)}ms`);

    return results;
  }

  /**
   * 创建Worker池
   */
  createWorkerPool(size) {
    const workers = [];
    for (let i = 0; i < size; i++) {
      // 注意：实际使用时需要创建真实的Worker文件
      // workers.push(new Worker('./speech-worker.js'));
    }
    return workers;
  }

  /**
   * 使用Worker处理任务
   */
  async processWithWorker(workerPool, task) {
    // 选择空闲的Worker
    const worker = workerPool[task.id % workerPool.length];

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        resolve(e.data);
      };

      worker.onerror = (error) => {
        reject(error);
      };

      worker.postMessage(task);
    });
  }

  /**
   * 自适应质量调整
   * 根据网络状况和设备性能动态调整
   */
  getOptimalSettings() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const memory = navigator.deviceMemory || 4; // GB

    const settings = {
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

    console.log('[SpeechOptimizer] 优化设置:', settings);
    return settings;
  }

  /**
   * 预加载模型
   * 提前加载识别模型以减少首次识别延迟
   */
  async preloadModels() {
    console.log('[SpeechOptimizer] 预加载识别模型...');

    try {
      // 创建一个临时的SpeechRecognition实例
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';

        // 启动并立即停止以触发模型加载
        recognition.start();
        setTimeout(() => recognition.stop(), 100);

        console.log('[SpeechOptimizer] 模型预加载完成');
      }
    } catch (error) {
      console.warn('[SpeechOptimizer] 模型预加载失败:', error);
    }
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    const cacheHitRate = this.metrics.totalRecognitions > 0
      ? (this.metrics.cacheHits / this.metrics.totalRecognitions * 100).toFixed(2)
      : 0;

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
  clearCache() {
    this.recognitionCache.clear();
    this.audioBufferPool.clear();
    console.log('[SpeechOptimizer] 缓存已清理');
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(maxAge = 3600000) { // 默认1小时
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.recognitionCache.entries()) {
      if (now - value.timestamp > maxAge) {
        this.recognitionCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[SpeechOptimizer] 清理了 ${cleaned} 个过期缓存项`);
    }
  }

  /**
   * 记录识别时间
   */
  recordRecognitionTime(time) {
    this.metrics.totalRecognitions++;
    this.metrics.recognitionTimes.push(time);

    // 只保留最近100次的记录
    if (this.metrics.recognitionTimes.length > 100) {
      this.metrics.recognitionTimes.shift();
    }

    // 计算平均时间
    const sum = this.metrics.recognitionTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageRecognitionTime = sum / this.metrics.recognitionTimes.length;
  }
}

// 导出单例
const speechOptimizer = new SpeechPerformanceOptimizer();

// 自动清理过期缓存（每10分钟）
setInterval(() => {
  speechOptimizer.cleanupExpiredCache();
}, 600000);

export default speechOptimizer;
