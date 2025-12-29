/**
 * 语音识别管理器
 *
 * 统一管理所有语音识别相关功能
 * 协调各子模块：配置、音频处理、识别引擎、存储
 */

const { EventEmitter } = require('events');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SpeechConfig = require('./speech-config');
const AudioProcessor = require('./audio-processor');
const AudioStorage = require('./audio-storage');
const { SpeechRecognizer } = require('./speech-recognizer');

/**
 * 语音识别管理器类
 */
class SpeechManager extends EventEmitter {
  constructor(databaseManager, ragManager = null) {
    super();
    this.db = databaseManager;
    this.ragManager = ragManager;

    // 子模块（延迟初始化）
    this.config = null;
    this.processor = null;
    this.storage = null;
    this.recognizer = null;

    // 任务队列
    this.taskQueue = [];
    this.runningTasks = 0;
    this.maxConcurrentTasks = 2;

    // 初始化状态
    this.initialized = false;
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    try {
      console.log('[SpeechManager] 初始化语音识别管理器...');

      // 加载配置
      this.config = new SpeechConfig();
      await this.config.load();

      const settings = this.config.getAll();

      // 初始化音频处理器
      this.processor = new AudioProcessor(settings.audio);
      this.setupProcessorEvents();

      // 检查 FFmpeg
      const ffmpegAvailable = await this.processor.checkFFmpeg();
      if (!ffmpegAvailable) {
        console.warn('[SpeechManager] FFmpeg 不可用，某些音频处理功能可能无法使用');
      }

      // 初始化存储
      this.storage = new AudioStorage(this.db, settings.storage.savePath);
      await this.storage.initialize();

      // 初始化识别器
      const engineConfig = this.config.getEngineConfig(settings.defaultEngine);
      this.recognizer = new SpeechRecognizer(settings.defaultEngine, engineConfig);

      // 设置并发任务数
      this.maxConcurrentTasks = settings.performance.maxConcurrentJobs || 2;

      this.initialized = true;
      console.log('[SpeechManager] 初始化完成');

      return true;
    } catch (error) {
      console.error('[SpeechManager] 初始化失败:', error);
      return false;
    }
  }

  /**
   * 设置音频处理器事件转发
   */
  setupProcessorEvents() {
    // 转换事件
    this.processor.on('convert-start', (data) => this.emit('process:convert-start', data));
    this.processor.on('convert-progress', (data) => this.emit('process:convert-progress', data));
    this.processor.on('convert-complete', (data) => this.emit('process:convert-complete', data));
    this.processor.on('convert-error', (data) => this.emit('process:convert-error', data));

    // 批处理事件
    this.processor.on('batch-progress', (data) => this.emit('process:batch-progress', data));
    this.processor.on('batch-complete', (data) => this.emit('process:batch-complete', data));
  }

  /**
   * 转录单个音频文件
   * @param {string} filePath - 音频文件路径
   * @param {Object} options - 转录选项
   * @returns {Promise<Object>}
   */
  async transcribeFile(filePath, options = {}) {
    this.ensureInitialized();

    const {
      engine = this.config.get('defaultEngine'),
      language = 'zh',
      saveToDatabase = true,
      saveToKnowledge = this.config.get('knowledgeIntegration.autoSaveToKnowledge'),
      addToIndex = this.config.get('knowledgeIntegration.autoAddToIndex'),
      keepProcessedFile = this.config.get('storage.keepProcessed'),
    } = options;

    try {
      this.emit('transcribe-start', { filePath });
      console.log('[SpeechManager] 开始转录:', path.basename(filePath));

      const audioId = uuidv4();
      const startTime = Date.now();

      // 1. 获取音频元数据
      const metadata = await this.processor.getMetadata(filePath);
      console.log('[SpeechManager] 音频时长:', metadata.duration.toFixed(2), '秒');

      this.emit('transcribe-progress', {
        filePath,
        step: 'metadata',
        percent: 10,
      });

      // 2. 检查是否需要分段处理
      const segmentDuration = this.config.get('audio.segmentDuration');
      let segments = [filePath];
      let needsSegmentation = false;

      if (metadata.duration > segmentDuration) {
        console.log('[SpeechManager] 音频较长，进行分段处理');
        needsSegmentation = true;
        segments = await this.processor.segmentAudio(filePath, segmentDuration);
      }

      this.emit('transcribe-progress', {
        filePath,
        step: 'segmentation',
        percent: 20,
        segments: segments.length,
      });

      // 3. 转换音频格式（如果需要）
      const processedSegments = [];

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        // 检查格式，如果不是 WAV 16kHz 单声道，则转换
        const shouldConvert = metadata.format !== 'wav' ||
          metadata.sampleRate !== 16000 ||
          metadata.channels !== 1;

        let processedPath = segment;

        if (shouldConvert) {
          const convertResult = await this.processor.convertToWhisperFormat(segment);
          processedPath = convertResult.outputPath;
        }

        processedSegments.push(processedPath);

        this.emit('transcribe-progress', {
          filePath,
          step: 'convert',
          percent: 20 + (i + 1) / segments.length * 30,
          currentSegment: i + 1,
          totalSegments: segments.length,
        });
      }

      // 4. 语音识别
      console.log('[SpeechManager] 开始语音识别，引擎:', engine);

      const transcriptions = [];

      for (let i = 0; i < processedSegments.length; i++) {
        const segmentPath = processedSegments[i];

        const result = await this.recognizer.recognize(segmentPath, {
          language: language,
          ...options,
        });

        transcriptions.push(result.text);

        this.emit('transcribe-progress', {
          filePath,
          step: 'recognize',
          percent: 50 + (i + 1) / processedSegments.length * 40,
          currentSegment: i + 1,
          totalSegments: processedSegments.length,
        });
      }

      // 合并分段结果
      const fullText = transcriptions.join('\n\n');

      const processingTime = Date.now() - startTime;

      console.log('[SpeechManager] 识别完成，文本长度:', fullText.length);

      // 5. 保存到数据库
      let savedAudioId = null;

      if (saveToDatabase) {
        const audioRecord = await this.storage.saveAudioFile(filePath, {
          id: audioId,
          fileName: path.basename(filePath),
          duration: metadata.duration,
          format: metadata.format,
          sample_rate: metadata.sampleRate,
          channels: metadata.channels,
          transcription_text: fullText,
          transcription_engine: engine,
          transcription_confidence: 0.95,
          language: language,
        });

        savedAudioId = audioRecord.id;

        // 添加转录历史
        await this.storage.addTranscriptionHistory({
          audio_file_id: savedAudioId,
          engine: engine,
          text: fullText,
          confidence: 0.95,
          duration: processingTime,
          status: 'completed',
        });

        console.log('[SpeechManager] 已保存到数据库');
      }

      this.emit('transcribe-progress', {
        filePath,
        step: 'save',
        percent: 90,
      });

      // 6. 添加到知识库（可选）
      let knowledgeId = null;

      if (saveToKnowledge && fullText.trim().length > 0) {
        try {
          const knowledgeItem = {
            title: `音频转录: ${path.basename(filePath)}`,
            content: fullText,
            type: this.config.get('knowledgeIntegration.defaultType') || 'note',
            tags: ['音频转录', engine],
            source: filePath,
            audio_id: savedAudioId,
          };

          // 使用数据库的知识库功能
          // 注意：这需要 database.js 中有 addKnowledgeItem 方法
          if (this.db.addKnowledgeItem) {
            const addedItem = await this.db.addKnowledgeItem(knowledgeItem);
            knowledgeId = addedItem.id;

            // 更新音频记录关联
            if (savedAudioId) {
              await this.storage.updateAudioRecord(savedAudioId, {
                knowledge_id: knowledgeId,
              });
            }

            console.log('[SpeechManager] 已添加到知识库:', knowledgeId);

            // 添加到 RAG 索引
            if (addToIndex && this.ragManager) {
              try {
                await this.ragManager.addToIndex(addedItem);
                console.log('[SpeechManager] 已添加到 RAG 索引');
              } catch (error) {
                console.error('[SpeechManager] 添加到 RAG 索引失败:', error);
              }
            }
          }
        } catch (error) {
          console.error('[SpeechManager] 添加到知识库失败:', error);
        }
      }

      // 7. 清理临时文件
      if (!keepProcessedFile) {
        const filesToClean = [];

        if (needsSegmentation) {
          filesToClean.push(...segments.filter(s => s !== filePath));
        }

        filesToClean.push(...processedSegments.filter(p => p !== filePath && !segments.includes(p)));

        if (filesToClean.length > 0) {
          await this.processor.cleanupTempFiles(filesToClean);
        }
      }

      // 构建结果
      const result = {
        success: true,
        id: savedAudioId,
        knowledgeId: knowledgeId,
        text: fullText,
        language: language,
        engine: engine,
        duration: metadata.duration,
        processingTime: processingTime,
        segments: segments.length,
        confidence: 0.95,
        wordCount: fullText.length,
      };

      this.emit('transcribe-complete', result);

      return result;
    } catch (error) {
      console.error('[SpeechManager] 转录失败:', error);
      this.emit('transcribe-error', { filePath, error });

      // 记录失败到数据库
      if (options.saveToDatabase) {
        try {
          await this.storage.addTranscriptionHistory({
            audio_file_id: null,
            engine: engine,
            text: '',
            status: 'failed',
            error: error.message,
          });
        } catch (dbError) {
          console.error('[SpeechManager] 记录失败状态到数据库失败:', dbError);
        }
      }

      throw error;
    }
  }

  /**
   * 批量转录音频文件
   * @param {Array} filePaths - 音频文件路径列表
   * @param {Object} options - 转录选项
   * @returns {Promise<Array>}
   */
  async transcribeBatch(filePaths, options = {}) {
    this.ensureInitialized();

    console.log(`[SpeechManager] 开始批量转录 ${filePaths.length} 个文件`);
    this.emit('batch-start', { total: filePaths.length });

    const results = [];

    for (let i = 0; i < filePaths.length; i++) {
      try {
        this.emit('batch-progress', {
          current: i + 1,
          total: filePaths.length,
          percentage: Math.round(((i + 1) / filePaths.length) * 100),
          currentFile: path.basename(filePaths[i]),
        });

        const result = await this.transcribeFile(filePaths[i], options);
        results.push({
          success: true,
          path: filePaths[i],
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          path: filePaths[i],
          error: error.message,
        });
      }
    }

    const summary = {
      total: filePaths.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results: results,
    };

    this.emit('batch-complete', summary);
    console.log('[SpeechManager] 批量转录完成:', summary);

    return summary;
  }

  /**
   * 获取配置
   */
  async getConfig() {
    this.ensureInitialized();
    return this.config.getAll();
  }

  /**
   * 更新配置
   */
  async updateConfig(newConfig) {
    this.ensureInitialized();
    return await this.config.update(newConfig);
  }

  /**
   * 设置识别引擎
   */
  async setEngine(engineType) {
    this.ensureInitialized();

    const engineConfig = this.config.getEngineConfig(engineType);
    this.recognizer.switchEngine(engineType, engineConfig);

    // 更新配置
    await this.config.set('defaultEngine', engineType);
    await this.config.save();

    console.log('[SpeechManager] 识别引擎已切换到:', engineType);

    return { success: true, engine: engineType };
  }

  /**
   * 获取可用引擎列表
   */
  async getAvailableEngines() {
    this.ensureInitialized();
    return await this.recognizer.getAvailableEngines();
  }

  /**
   * 获取转录历史
   */
  async getHistory(limit = 100, offset = 0) {
    this.ensureInitialized();
    return await this.storage.getAllTranscriptionHistory({ limit, offset });
  }

  /**
   * 删除转录历史
   */
  async deleteHistory(id) {
    this.ensureInitialized();
    return await this.storage.deleteTranscriptionHistory(id);
  }

  /**
   * 获取音频文件
   */
  async getAudioFile(id) {
    this.ensureInitialized();
    return await this.storage.getAudioRecord(id);
  }

  /**
   * 列出所有音频文件
   */
  async listAudioFiles(options = {}) {
    this.ensureInitialized();
    return await this.storage.getAllAudioFiles(options);
  }

  /**
   * 搜索音频文件
   */
  async searchAudioFiles(query, options = {}) {
    this.ensureInitialized();
    return await this.storage.searchAudioFiles(query, options);
  }

  /**
   * 删除音频文件
   */
  async deleteAudioFile(id) {
    this.ensureInitialized();
    return await this.storage.deleteAudioFile(id);
  }

  /**
   * 获取统计信息
   */
  async getStats(userId = 'local-user') {
    this.ensureInitialized();
    return await this.storage.getStats(userId);
  }

  /**
   * 确保已初始化
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('SpeechManager 尚未初始化。请先调用 initialize() 方法。');
    }
  }

  /**
   * 终止服务
   */
  async terminate() {
    console.log('[SpeechManager] 终止服务...');
    // 清理资源
    this.removeAllListeners();
  }
}

module.exports = SpeechManager;
