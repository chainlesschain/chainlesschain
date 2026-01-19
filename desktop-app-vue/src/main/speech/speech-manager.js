/**
 * 语音识别管理器
 *
 * 统一管理所有语音识别相关功能
 * 协调各子模块：配置、音频处理、识别引擎、存储
 */

const { EventEmitter } = require('events');
const path = require('path');
const os = require('os'); // 新增：用于动态并发数
const { v4: uuidv4 } = require('uuid');

const SpeechConfig = require('./speech-config');
const AudioProcessor = require('./audio-processor');
const AudioStorage = require('./audio-storage');
const { SpeechRecognizer } = require('./speech-recognizer');
const { SubtitleGenerator } = require('./subtitle-generator');
const RealtimeVoiceInput = require('./realtime-voice-input');
const VoiceCommandRecognizer = require('./voice-command-recognizer');
const AudioCache = require('./audio-cache');

/**
 * 语音识别管理器类
 *
 * 支持依赖注入以提高可测试性
 */
class SpeechManager extends EventEmitter {
  constructor(databaseManager, ragManager = null, dependencies = {}) {
    super();
    this.db = databaseManager;
    this.ragManager = ragManager;

    // 依赖注入：允许在测试中替换实现
    // 如果未提供，则使用默认实现
    this.dependencies = {
      ConfigClass: dependencies.ConfigClass || SpeechConfig,
      ProcessorClass: dependencies.ProcessorClass || AudioProcessor,
      StorageClass: dependencies.StorageClass || AudioStorage,
      RecognizerClass: dependencies.RecognizerClass || SpeechRecognizer,
      SubtitleClass: dependencies.SubtitleClass || SubtitleGenerator,
    };

    // 子模块（延迟初始化）
    this.config = null;
    this.processor = null;
    this.storage = null;
    this.recognizer = null;
    this.subtitleGenerator = null;
    this.realtimeInput = null;
    this.commandRecognizer = null;
    this.audioCache = null;

    // 任务队列
    this.taskQueue = [];
    this.runningTasks = 0;
    // 动态并发数：基于CPU核心数，最多4个并发任务
    this.maxConcurrentTasks = Math.min(os.cpus().length, 4);

    // 初始化状态
    this.initialized = false;
  }

  /**
   * 初始化管理器
   *
   * 使用依赖注入的类来创建实例，提高可测试性
   */
  async initialize() {
    try {
      console.log('[SpeechManager] 初始化语音识别管理器...');

      // 加载配置（使用注入的或默认的类）
      this.config = new this.dependencies.ConfigClass();
      await this.config.load();

      const settings = this.config.getAll();

      // 初始化音频处理器（使用注入的或默认的类）
      this.processor = new this.dependencies.ProcessorClass(settings.audio);
      this.setupProcessorEvents();

      // 检查 FFmpeg
      const ffmpegAvailable = await this.processor.checkFFmpeg();
      if (!ffmpegAvailable) {
        console.warn('[SpeechManager] FFmpeg 不可用，某些音频处理功能可能无法使用');
      }

      // 初始化存储（使用注入的或默认的类）
      this.storage = new this.dependencies.StorageClass(this.db, settings.storage.savePath);
      await this.storage.initialize();

      // 初始化识别器（使用注入的或默认的类）
      const engineConfig = this.config.getEngineConfig(settings.defaultEngine);
      this.recognizer = new this.dependencies.RecognizerClass(settings.defaultEngine, engineConfig);

      // 初始化字幕生成器（使用注入的或默认的类）
      this.subtitleGenerator = new this.dependencies.SubtitleClass();

      // 初始化音频缓存
      const cacheDir = path.join(settings.storage.savePath, '.cache', 'audio-transcripts');
      this.audioCache = new AudioCache(cacheDir, {
        maxCacheSize: 100 * 1024 * 1024, // 100MB
        maxCacheAge: 30 * 24 * 60 * 60 * 1000, // 30天
        maxMemoryEntries: 50
      });
      await this.audioCache.initialize();

      // 初始化语音命令识别器
      this.commandRecognizer = new VoiceCommandRecognizer({
        language: settings.defaultLanguage || 'zh',
        minConfidence: 0.7,
        fuzzyMatch: true,
        contextAware: true
      });

      // 初始化实时语音输入
      this.realtimeInput = new RealtimeVoiceInput(this.recognizer, {
        sampleRate: 16000,
        channels: 1,
        chunkDuration: 3000,
        silenceThreshold: 0.01,
        silenceDuration: 1000,
        maxRecordingTime: 300000
      });

      // 设置实时输入事件转发
      this.setupRealtimeEvents();

      // 设置并发任务数（优先使用配置，否则使用动态计算的默认值）
      if (settings.performance && settings.performance.maxConcurrentJobs) {
        this.maxConcurrentTasks = settings.performance.maxConcurrentJobs;
      }
      // else: 保持构造函数中设置的动态并发数

      console.log(`[SpeechManager] 并发任务数: ${this.maxConcurrentTasks} (CPU核心数: ${os.cpus().length})`);

      this.initialized = true;
      console.log('[SpeechManager] 初始化完成（含实时语音输入）');

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
   * 设置实时语音输入事件转发
   */
  setupRealtimeEvents() {
    if (!this.realtimeInput) {return;}

    // 录音事件
    this.realtimeInput.on('recording:started', (data) => this.emit('realtime:started', data));
    this.realtimeInput.on('recording:stopped', (data) => this.emit('realtime:stopped', data));
    this.realtimeInput.on('recording:paused', (data) => this.emit('realtime:paused', data));
    this.realtimeInput.on('recording:resumed', (data) => this.emit('realtime:resumed', data));
    this.realtimeInput.on('recording:cancelled', (data) => this.emit('realtime:cancelled', data));

    // 音频事件
    this.realtimeInput.on('audio:volume', (data) => this.emit('realtime:volume', data));
    this.realtimeInput.on('silence:detected', () => this.emit('realtime:silence'));

    // Chunk处理事件
    this.realtimeInput.on('chunk:processing', (data) => this.emit('realtime:chunk-processing', data));
    this.realtimeInput.on('chunk:processed', (data) => this.emit('realtime:chunk-processed', data));
    this.realtimeInput.on('chunk:error', (data) => this.emit('realtime:chunk-error', data));

    // 转录事件
    this.realtimeInput.on('transcript:partial', (data) => {
      // 识别命令
      if (this.commandRecognizer && data.text) {
        const command = this.commandRecognizer.recognize(data.text);
        if (command) {
          this.emit('realtime:command', command);
        }
      }
      this.emit('realtime:partial', data);
    });
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

      // 3. 转换音频格式（如果需要） - 并发处理提升性能
      const processedSegments = [];

      // 检查格式，如果不是 WAV 16kHz 单声道，则转换
      const shouldConvert = metadata.format !== 'wav' ||
        metadata.sampleRate !== 16000 ||
        metadata.channels !== 1;

      if (shouldConvert) {
        console.log(`[SpeechManager] 并发转换 ${segments.length} 个音频段...`);

        // 并发转换所有分段（关键优化：从顺序改为并发）
        const convertPromises = segments.map((segment, i) =>
          this.processor.convertToWhisperFormat(segment).then(convertResult => {
            // 发送每个分段的进度
            this.emit('transcribe-progress', {
              filePath,
              step: 'convert',
              percent: 20 + (i + 1) / segments.length * 30,
              currentSegment: i + 1,
              totalSegments: segments.length,
            });
            return convertResult.outputPath;
          })
        );

        // 等待所有转换完成
        const convertedPaths = await Promise.all(convertPromises);
        processedSegments.push(...convertedPaths);

        console.log(`[SpeechManager] 并发转换完成，共 ${convertedPaths.length} 个文件`);
      } else {
        // 无需转换，直接使用原始分段
        processedSegments.push(...segments);
        console.log(`[SpeechManager] 音频格式已符合要求，跳过转换`);
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
   * 音频降噪
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 降噪选项
   * @returns {Promise<Object>}
   */
  async denoiseAudio(inputPath, outputPath, options = {}) {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始音频降噪:', path.basename(inputPath));

      const result = await this.processor.denoiseAudio(inputPath, outputPath, options);

      console.log('[SpeechManager] 降噪完成');

      return result;
    } catch (error) {
      console.error('[SpeechManager] 降噪失败:', error);
      throw error;
    }
  }

  /**
   * 音频增强（综合处理：降噪+归一化+均衡）
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 增强选项
   * @returns {Promise<Object>}
   */
  async enhanceAudio(inputPath, outputPath, options = {}) {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始音频增强:', path.basename(inputPath));

      const result = await this.processor.enhanceAudio(inputPath, outputPath, options);

      console.log('[SpeechManager] 增强完成，应用了', result.appliedFilters, '个滤镜');

      return result;
    } catch (error) {
      console.error('[SpeechManager] 增强失败:', error);
      throw error;
    }
  }

  /**
   * 语音增强（专门针对语音识别优化）
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @returns {Promise<Object>}
   */
  async enhanceForSpeechRecognition(inputPath, outputPath) {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始语音增强:', path.basename(inputPath));

      const result = await this.processor.enhanceForSpeechRecognition(inputPath, outputPath);

      console.log('[SpeechManager] 语音增强完成');

      return result;
    } catch (error) {
      console.error('[SpeechManager] 语音增强失败:', error);
      throw error;
    }
  }

  /**
   * 自动检测音频语言
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>}
   */
  async detectLanguage(audioPath) {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始检测语言:', path.basename(audioPath));

      // 使用识别器的语言检测功能
      const result = await this.recognizer.engine.detectLanguage(audioPath);

      console.log('[SpeechManager] 检测到语言:', result.languageName, `(${result.language})`);

      return result;
    } catch (error) {
      console.error('[SpeechManager] 语言检测失败:', error);
      throw error;
    }
  }

  /**
   * 批量检测语言
   * @param {Array} audioPaths - 音频文件路径列表
   * @returns {Promise<Array>}
   */
  async detectLanguages(audioPaths) {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始批量语言检测，文件数:', audioPaths.length);

      const results = await this.recognizer.engine.detectLanguages(audioPaths);

      const summary = {
        total: audioPaths.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results,
      };

      console.log('[SpeechManager] 批量语言检测完成:', summary);

      return summary;
    } catch (error) {
      console.error('[SpeechManager] 批量语言检测失败:', error);
      throw error;
    }
  }

  /**
   * 生成字幕文件
   * @param {string} audioId - 音频文件ID
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式 (srt|vtt)
   * @returns {Promise<Object>}
   */
  async generateSubtitle(audioId, outputPath, format = 'srt') {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始生成字幕:', audioId);

      // 获取音频记录
      const audioRecord = await this.storage.getAudioRecord(audioId);

      if (!audioRecord) {
        throw new Error(`未找到音频记录: ${audioId}`);
      }

      if (!audioRecord.transcription_text) {
        throw new Error('该音频尚未转录，无法生成字幕');
      }

      // 生成字幕条目
      const subtitles = this.subtitleGenerator.generateFromText(
        audioRecord.transcription_text,
        audioRecord.duration
      );

      // 保存字幕文件
      const result = await this.subtitleGenerator.saveSubtitleFile(
        subtitles,
        outputPath,
        format
      );

      console.log('[SpeechManager] 字幕生成完成:', result.outputPath);

      return result;
    } catch (error) {
      console.error('[SpeechManager] 字幕生成失败:', error);
      throw error;
    }
  }

  /**
   * 转录并生成字幕（一步完成）
   * @param {string} audioPath - 音频文件路径
   * @param {string} subtitlePath - 字幕输出路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async transcribeAndGenerateSubtitle(audioPath, subtitlePath, options = {}) {
    this.ensureInitialized();

    const {
      format = 'srt',
      language = 'zh',
      enhanceAudio = false,
    } = options;

    try {
      console.log('[SpeechManager] 开始转录并生成字幕:', path.basename(audioPath));

      let processedPath = audioPath;

      // 1. 音频增强（可选）
      if (enhanceAudio) {
        const enhancedPath = path.join(
          path.dirname(audioPath),
          `enhanced_${path.basename(audioPath)}`
        );
        await this.enhanceForSpeechRecognition(audioPath, enhancedPath);
        processedPath = enhancedPath;
      }

      // 2. 使用 Whisper API 直接生成字幕（如果引擎支持）
      const engineType = this.config.get('defaultEngine');

      if (engineType === 'whisper-api') {
        // Whisper API 支持直接返回 SRT/VTT 格式
        const whisperFormat = format === 'srt' ? 'srt' : 'vtt';

        const result = await this.recognizer.recognize(processedPath, {
          language: language,
          responseFormat: whisperFormat,
        });

        // 保存 Whisper 返回的字幕
        await this.subtitleGenerator.saveWhisperSubtitle(
          result.text,
          subtitlePath,
          format
        );

        console.log('[SpeechManager] 使用 Whisper API 直接生成字幕完成');

        return {
          success: true,
          subtitlePath: subtitlePath,
          format: format,
          text: result.text,
          method: 'whisper-api-direct',
        };
      } else {
        // 3. 其他引擎：先转录，再生成字幕
        const transcribeResult = await this.transcribeFile(processedPath, {
          language: language,
          saveToDatabase: true,
        });

        const subtitles = this.subtitleGenerator.generateFromText(
          transcribeResult.text,
          transcribeResult.duration
        );

        await this.subtitleGenerator.saveSubtitleFile(subtitles, subtitlePath, format);

        console.log('[SpeechManager] 转录并生成字幕完成');

        return {
          success: true,
          subtitlePath: subtitlePath,
          format: format,
          text: transcribeResult.text,
          audioId: transcribeResult.id,
          method: 'transcribe-then-generate',
        };
      }
    } catch (error) {
      console.error('[SpeechManager] 转录并生成字幕失败:', error);
      throw error;
    }
  }

  /**
   * 批量生成字幕
   * @param {Array} audioIds - 音频ID列表
   * @param {string} outputDir - 输出目录
   * @param {string} format - 格式
   * @returns {Promise<Array>}
   */
  async batchGenerateSubtitles(audioIds, outputDir, format = 'srt') {
    this.ensureInitialized();

    try {
      console.log('[SpeechManager] 开始批量生成字幕，数量:', audioIds.length);

      const results = [];

      for (const audioId of audioIds) {
        try {
          const audioRecord = await this.storage.getAudioRecord(audioId);
          const baseName = path.basename(audioRecord.file_name, path.extname(audioRecord.file_name));
          const outputPath = path.join(outputDir, `${baseName}.${format}`);

          const result = await this.generateSubtitle(audioId, outputPath, format);

          results.push({
            success: true,
            audioId: audioId,
            ...result,
          });
        } catch (error) {
          results.push({
            success: false,
            audioId: audioId,
            error: error.message,
          });
        }
      }

      const summary = {
        total: audioIds.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results,
      };

      console.log('[SpeechManager] 批量字幕生成完成:', summary);

      return summary;
    } catch (error) {
      console.error('[SpeechManager] 批量字幕生成失败:', error);
      throw error;
    }
  }

  /**
   * 开始实时录音
   * @param {Object} options - 录音选项
   * @returns {Promise<void>}
   */
  async startRealtimeRecording(options = {}) {
    this.ensureInitialized();
    console.log('[SpeechManager] 开始实时录音');
    return await this.realtimeInput.startRecording(options);
  }

  /**
   * 添加音频数据（来自浏览器端）
   * @param {Buffer} audioData - PCM音频数据
   */
  addRealtimeAudioData(audioData) {
    this.ensureInitialized();
    this.realtimeInput.addAudioData(audioData);
  }

  /**
   * 暂停实时录音
   */
  pauseRealtimeRecording() {
    this.ensureInitialized();
    return this.realtimeInput.pause();
  }

  /**
   * 恢复实时录音
   */
  resumeRealtimeRecording() {
    this.ensureInitialized();
    return this.realtimeInput.resume();
  }

  /**
   * 停止实时录音
   * @returns {Promise<Object>} 转录结果
   */
  async stopRealtimeRecording() {
    this.ensureInitialized();
    console.log('[SpeechManager] 停止实时录音');
    return await this.realtimeInput.stopRecording();
  }

  /**
   * 取消实时录音
   */
  cancelRealtimeRecording() {
    this.ensureInitialized();
    return this.realtimeInput.cancel();
  }

  /**
   * 获取实时录音状态
   * @returns {Object}
   */
  getRealtimeStatus() {
    this.ensureInitialized();
    return this.realtimeInput.getStatus();
  }

  /**
   * 识别语音命令
   * @param {string} text - 语音文本
   * @param {Object} context - 上下文信息
   * @returns {Object|null} 识别结果
   */
  recognizeCommand(text, context = {}) {
    this.ensureInitialized();
    return this.commandRecognizer.recognize(text, context);
  }

  /**
   * 注册自定义命令
   * @param {Object} command - 命令配置
   */
  registerCommand(command) {
    this.ensureInitialized();
    return this.commandRecognizer.registerCommand(command);
  }

  /**
   * 获取所有注册的命令
   * @returns {Array}
   */
  getAllCommands() {
    this.ensureInitialized();
    return this.commandRecognizer.getAllCommands();
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>}
   */
  async getCacheStats() {
    this.ensureInitialized();
    return await this.audioCache.getStats();
  }

  /**
   * 清空音频缓存
   * @returns {Promise<void>}
   */
  async clearCache() {
    this.ensureInitialized();
    return await this.audioCache.clear();
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

    // 停止实时录音
    if (this.realtimeInput && this.realtimeInput.isRecording) {
      this.realtimeInput.cancel();
    }

    // 清理资源
    this.removeAllListeners();
  }
}

module.exports = SpeechManager;
module.exports.SpeechManager = SpeechManager;
