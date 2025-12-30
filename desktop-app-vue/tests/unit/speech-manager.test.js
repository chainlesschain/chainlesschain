/**
 * Speech Manager 单元测试
 *
 * 测试语音识别管理器的核心功能：
 * - 管理器初始化
 * - 单文件转录
 * - 批量转录
 * - 音频处理（降噪、增强）
 * - 字幕生成
 * - 配置管理
 * - 引擎切换
 * - 历史记录管理
 * - 知识库集成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock 模块
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    basename: vi.fn((filepath) => {
      if (typeof filepath === 'string') {
        return filepath.split('/').pop().split('\\').pop();
      }
      return 'test.wav';
    }),
    dirname: vi.fn(() => '/mock/dir'),
    join: vi.fn((...args) => args.join('/')),
    extname: vi.fn((filepath) => {
      const match = filepath.match(/\.[^.]+$/);
      return match ? match[0] : '';
    }),
  };
});

// Mock 子模块
const mockConfig = {
  load: vi.fn().mockResolvedValue(true),
  getAll: vi.fn().mockReturnValue({
    defaultEngine: 'whisper-api',
    audio: { segmentDuration: 600 },
    storage: { savePath: '/data/audio', keepProcessed: false },
    performance: { maxConcurrentJobs: 2 },
    knowledgeIntegration: {
      autoSaveToKnowledge: true,
      autoAddToIndex: true,
      defaultType: 'note',
    },
  }),
  get: vi.fn((key) => {
    const config = {
      defaultEngine: 'whisper-api',
      'audio.segmentDuration': 600,
      'storage.keepProcessed': false,
      'knowledgeIntegration.autoSaveToKnowledge': true,
      'knowledgeIntegration.autoAddToIndex': true,
      'knowledgeIntegration.defaultType': 'note',
    };
    return config[key];
  }),
  set: vi.fn(),
  save: vi.fn().mockResolvedValue(true),
  getEngineConfig: vi.fn().mockReturnValue({ apiKey: 'test-key' }),
  update: vi.fn().mockResolvedValue(true),
};

const mockProcessor = new EventEmitter();
mockProcessor.checkFFmpeg = vi.fn().mockResolvedValue(true);
mockProcessor.getMetadata = vi.fn().mockResolvedValue({
  duration: 120.5,
  format: 'mp3',
  sampleRate: 44100,
  channels: 2,
});
mockProcessor.segmentAudio = vi.fn().mockResolvedValue(['/audio1.wav', '/audio2.wav']);
mockProcessor.convertToWhisperFormat = vi.fn().mockResolvedValue({ outputPath: '/converted.wav' });
mockProcessor.cleanupTempFiles = vi.fn().mockResolvedValue(true);
mockProcessor.denoiseAudio = vi.fn().mockResolvedValue({ success: true, outputPath: '/denoised.wav' });
mockProcessor.enhanceAudio = vi.fn().mockResolvedValue({
  success: true,
  outputPath: '/enhanced.wav',
  appliedFilters: 3,
});
mockProcessor.enhanceForSpeechRecognition = vi.fn().mockResolvedValue({
  success: true,
  outputPath: '/enhanced-speech.wav',
});

const mockStorage = {
  initialize: vi.fn().mockResolvedValue(true),
  saveAudioFile: vi.fn().mockResolvedValue({ id: 'audio-123' }),
  addTranscriptionHistory: vi.fn().mockResolvedValue({ id: 'history-123' }),
  updateAudioRecord: vi.fn().mockResolvedValue(true),
  getAudioRecord: vi.fn().mockResolvedValue({
    id: 'audio-123',
    file_name: 'test.wav',
    duration: 120.5,
    transcription_text: 'Test transcription',
  }),
  getAllTranscriptionHistory: vi.fn().mockResolvedValue([]),
  deleteTranscriptionHistory: vi.fn().mockResolvedValue(true),
  getAllAudioFiles: vi.fn().mockResolvedValue([]),
  searchAudioFiles: vi.fn().mockResolvedValue([]),
  deleteAudioFile: vi.fn().mockResolvedValue(true),
  getStats: vi.fn().mockResolvedValue({ total: 10, duration: 1200 }),
};

const mockRecognizer = {
  recognize: vi.fn().mockResolvedValue({
    success: true,
    text: 'This is a test transcription.',
    language: 'zh',
    confidence: 0.95,
  }),
  switchEngine: vi.fn(),
  getAvailableEngines: vi.fn().mockResolvedValue([]),
  engine: {
    detectLanguage: vi.fn().mockResolvedValue({
      success: true,
      language: 'zh',
      languageName: '中文',
      confidence: 0.9,
    }),
    detectLanguages: vi.fn().mockResolvedValue([]),
  },
};

const mockSubtitleGenerator = {
  generateFromText: vi.fn().mockReturnValue([
    { index: 1, start: '00:00:00,000', end: '00:00:05,000', text: 'Line 1' },
    { index: 2, start: '00:00:05,000', end: '00:00:10,000', text: 'Line 2' },
  ]),
  saveSubtitleFile: vi.fn().mockResolvedValue({ success: true, outputPath: '/subtitle.srt' }),
  saveWhisperSubtitle: vi.fn().mockResolvedValue({ success: true }),
};

// Mock 类构造函数
vi.mock('../../src/main/speech/speech-config', () => ({
  default: vi.fn(() => mockConfig),
}));

vi.mock('../../src/main/speech/audio-processor', () => ({
  default: vi.fn(() => mockProcessor),
}));

vi.mock('../../src/main/speech/audio-storage', () => ({
  default: vi.fn(() => mockStorage),
}));

vi.mock('../../src/main/speech/speech-recognizer', () => ({
  SpeechRecognizer: vi.fn(() => mockRecognizer),
}));

vi.mock('../../src/main/speech/subtitle-generator', () => ({
  SubtitleGenerator: vi.fn(() => mockSubtitleGenerator),
}));

// 导入被测试的模块
const SpeechManager = require('../../src/main/speech/speech-manager');

describe('SpeechManager', () => {
  let manager;
  let mockDb;
  let mockRagManager;

  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks();

    // 创建 mock 数据库
    mockDb = {
      addKnowledgeItem: vi.fn().mockResolvedValue({ id: 'knowledge-123' }),
    };

    // 创建 mock RAG 管理器
    mockRagManager = {
      addToIndex: vi.fn().mockResolvedValue(true),
    };

    // 创建管理器实例
    manager = new SpeechManager(mockDb, mockRagManager);
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe('构造函数', () => {
    it('should create instance with database', () => {
      expect(manager).toBeInstanceOf(SpeechManager);
      expect(manager.db).toBe(mockDb);
      expect(manager.initialized).toBe(false);
    });

    it('should create instance with optional RAG manager', () => {
      const managerWithoutRag = new SpeechManager(mockDb);
      expect(managerWithoutRag.ragManager).toBeNull();
    });

    it('should initialize task queue', () => {
      expect(manager.taskQueue).toEqual([]);
      expect(manager.runningTasks).toBe(0);
      expect(manager.maxConcurrentTasks).toBe(2);
    });
  });

  describe('initialize()', () => {
    it('should initialize all submodules', async () => {
      const result = await manager.initialize();

      expect(result).toBe(true);
      expect(manager.initialized).toBe(true);
      expect(mockConfig.load).toHaveBeenCalled();
      expect(mockProcessor.checkFFmpeg).toHaveBeenCalled();
      expect(mockStorage.initialize).toHaveBeenCalled();
    });

    it('should set maxConcurrentTasks from config', async () => {
      mockConfig.getAll.mockReturnValueOnce({
        defaultEngine: 'whisper-api',
        audio: {},
        storage: { savePath: '/data' },
        performance: { maxConcurrentJobs: 5 },
        knowledgeIntegration: {},
      });

      await manager.initialize();

      expect(manager.maxConcurrentTasks).toBe(5);
    });

    it('should handle FFmpeg not available', async () => {
      mockProcessor.checkFFmpeg.mockResolvedValueOnce(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await manager.initialize();

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('FFmpeg 不可用')
      );

      consoleSpy.mockRestore();
    });

    it('should return false on initialization error', async () => {
      mockConfig.load.mockRejectedValueOnce(new Error('Config load failed'));

      const result = await manager.initialize();

      expect(result).toBe(false);
      expect(manager.initialized).toBe(false);
    });
  });

  describe('setupProcessorEvents()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should forward convert events', () => {
      const convertStartSpy = vi.fn();
      const convertProgressSpy = vi.fn();
      const convertCompleteSpy = vi.fn();
      const convertErrorSpy = vi.fn();

      manager.on('process:convert-start', convertStartSpy);
      manager.on('process:convert-progress', convertProgressSpy);
      manager.on('process:convert-complete', convertCompleteSpy);
      manager.on('process:convert-error', convertErrorSpy);

      mockProcessor.emit('convert-start', { file: 'test.wav' });
      mockProcessor.emit('convert-progress', { percent: 50 });
      mockProcessor.emit('convert-complete', { success: true });
      mockProcessor.emit('convert-error', { error: 'Failed' });

      expect(convertStartSpy).toHaveBeenCalledWith({ file: 'test.wav' });
      expect(convertProgressSpy).toHaveBeenCalledWith({ percent: 50 });
      expect(convertCompleteSpy).toHaveBeenCalledWith({ success: true });
      expect(convertErrorSpy).toHaveBeenCalledWith({ error: 'Failed' });
    });

    it('should forward batch events', () => {
      const batchProgressSpy = vi.fn();
      const batchCompleteSpy = vi.fn();

      manager.on('process:batch-progress', batchProgressSpy);
      manager.on('process:batch-complete', batchCompleteSpy);

      mockProcessor.emit('batch-progress', { current: 5 });
      mockProcessor.emit('batch-complete', { total: 10 });

      expect(batchProgressSpy).toHaveBeenCalledWith({ current: 5 });
      expect(batchCompleteSpy).toHaveBeenCalledWith({ total: 10 });
    });
  });

  describe('transcribeFile()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should transcribe audio file successfully', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      const result = await manager.transcribeFile('/test.wav');

      expect(result.success).toBe(true);
      expect(result.text).toBe('This is a test transcription.');
      expect(result.engine).toBe('whisper-api');
      expect(mockRecognizer.recognize).toHaveBeenCalled();
      expect(mockStorage.saveAudioFile).toHaveBeenCalled();
    });

    it('should emit transcribe events', async () => {
      const startSpy = vi.fn();
      const progressSpy = vi.fn();
      const completeSpy = vi.fn();

      manager.on('transcribe-start', startSpy);
      manager.on('transcribe-progress', progressSpy);
      manager.on('transcribe-complete', completeSpy);

      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      await manager.transcribeFile('/test.wav');

      expect(startSpy).toHaveBeenCalled();
      expect(progressSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should segment long audio', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 1200.0, // 20 minutes
        format: 'mp3',
        sampleRate: 44100,
        channels: 2,
      });

      mockRecognizer.recognize
        .mockResolvedValueOnce({ text: 'Part 1', language: 'zh' })
        .mockResolvedValueOnce({ text: 'Part 2', language: 'zh' });

      const result = await manager.transcribeFile('/long-audio.mp3');

      expect(mockProcessor.segmentAudio).toHaveBeenCalled();
      expect(result.segments).toBe(2);
      expect(result.text).toContain('Part 1');
      expect(result.text).toContain('Part 2');
    });

    it('should convert audio format if needed', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'mp3',
        sampleRate: 44100,
        channels: 2,
      });

      await manager.transcribeFile('/test.mp3');

      expect(mockProcessor.convertToWhisperFormat).toHaveBeenCalled();
    });

    it('should save to knowledge base when enabled', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      await manager.transcribeFile('/test.wav', {
        saveToKnowledge: true,
        addToIndex: true,
      });

      expect(mockDb.addKnowledgeItem).toHaveBeenCalled();
      expect(mockRagManager.addToIndex).toHaveBeenCalled();
      expect(mockStorage.updateAudioRecord).toHaveBeenCalledWith(
        'audio-123',
        { knowledge_id: 'knowledge-123' }
      );
    });

    it('should cleanup temp files when keepProcessedFile is false', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 1200.0,
        format: 'mp3',
        sampleRate: 44100,
        channels: 2,
      });

      mockRecognizer.recognize
        .mockResolvedValueOnce({ text: 'Part 1' })
        .mockResolvedValueOnce({ text: 'Part 2' });

      await manager.transcribeFile('/long.mp3', { keepProcessedFile: false });

      expect(mockProcessor.cleanupTempFiles).toHaveBeenCalled();
    });

    it('should handle recognition error', async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      mockRecognizer.recognize.mockRejectedValueOnce(new Error('Recognition failed'));

      const errorSpy = vi.fn();
      manager.on('transcribe-error', errorSpy);

      await expect(manager.transcribeFile('/test.wav')).rejects.toThrow('Recognition failed');
      expect(errorSpy).toHaveBeenCalled();
      expect(mockStorage.addTranscriptionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new SpeechManager(mockDb);

      await expect(uninitializedManager.transcribeFile('/test.wav')).rejects.toThrow(
        '尚未初始化'
      );
    });
  });

  describe('transcribeBatch()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should transcribe multiple files', async () => {
      mockProcessor.getMetadata.mockResolvedValue({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      const files = ['/file1.wav', '/file2.wav', '/file3.wav'];

      const result = await manager.transcribeBatch(files);

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockRecognizer.recognize).toHaveBeenCalledTimes(3);
    });

    it('should emit batch events', async () => {
      const startSpy = vi.fn();
      const progressSpy = vi.fn();
      const completeSpy = vi.fn();

      manager.on('batch-start', startSpy);
      manager.on('batch-progress', progressSpy);
      manager.on('batch-complete', completeSpy);

      mockProcessor.getMetadata.mockResolvedValue({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      await manager.transcribeBatch(['/file1.wav', '/file2.wav']);

      expect(startSpy).toHaveBeenCalledWith({ total: 2 });
      expect(progressSpy).toHaveBeenCalledTimes(2);
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should handle partial failures', async () => {
      mockProcessor.getMetadata
        .mockResolvedValueOnce({ duration: 30.0, format: 'wav', sampleRate: 16000, channels: 1 })
        .mockRejectedValueOnce(new Error('File not found'))
        .mockResolvedValueOnce({ duration: 30.0, format: 'wav', sampleRate: 16000, channels: 1 });

      const files = ['/file1.wav', '/file2.wav', '/file3.wav'];

      const result = await manager.transcribeBatch(files);

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
    });
  });

  describe('Config Management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should get config', async () => {
      const config = await manager.getConfig();

      expect(config).toBeDefined();
      expect(mockConfig.getAll).toHaveBeenCalled();
    });

    it('should update config', async () => {
      const newConfig = { defaultEngine: 'whisper-local' };

      await manager.updateConfig(newConfig);

      expect(mockConfig.update).toHaveBeenCalledWith(newConfig);
    });

    it('should set engine', async () => {
      const result = await manager.setEngine('whisper-local');

      expect(result.success).toBe(true);
      expect(result.engine).toBe('whisper-local');
      expect(mockRecognizer.switchEngine).toHaveBeenCalled();
      expect(mockConfig.save).toHaveBeenCalled();
    });

    it('should get available engines', async () => {
      await manager.getAvailableEngines();

      expect(mockRecognizer.getAvailableEngines).toHaveBeenCalled();
    });
  });

  describe('History Management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should get history', async () => {
      await manager.getHistory(50, 10);

      expect(mockStorage.getAllTranscriptionHistory).toHaveBeenCalledWith({
        limit: 50,
        offset: 10,
      });
    });

    it('should delete history', async () => {
      await manager.deleteHistory('history-123');

      expect(mockStorage.deleteTranscriptionHistory).toHaveBeenCalledWith('history-123');
    });
  });

  describe('Audio File Management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should get audio file', async () => {
      const result = await manager.getAudioFile('audio-123');

      expect(result).toBeDefined();
      expect(mockStorage.getAudioRecord).toHaveBeenCalledWith('audio-123');
    });

    it('should list audio files', async () => {
      await manager.listAudioFiles({ limit: 20 });

      expect(mockStorage.getAllAudioFiles).toHaveBeenCalledWith({ limit: 20 });
    });

    it('should search audio files', async () => {
      await manager.searchAudioFiles('keyword');

      expect(mockStorage.searchAudioFiles).toHaveBeenCalledWith('keyword', {});
    });

    it('should delete audio file', async () => {
      await manager.deleteAudioFile('audio-123');

      expect(mockStorage.deleteAudioFile).toHaveBeenCalledWith('audio-123');
    });

    it('should get stats', async () => {
      const stats = await manager.getStats('user-123');

      expect(stats).toBeDefined();
      expect(mockStorage.getStats).toHaveBeenCalledWith('user-123');
    });
  });

  describe('Audio Processing', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should denoise audio', async () => {
      const result = await manager.denoiseAudio('/input.wav', '/output.wav');

      expect(result.success).toBe(true);
      expect(mockProcessor.denoiseAudio).toHaveBeenCalledWith('/input.wav', '/output.wav', {});
    });

    it('should enhance audio', async () => {
      const result = await manager.enhanceAudio('/input.wav', '/output.wav', { level: 2 });

      expect(result.success).toBe(true);
      expect(result.appliedFilters).toBe(3);
      expect(mockProcessor.enhanceAudio).toHaveBeenCalledWith('/input.wav', '/output.wav', {
        level: 2,
      });
    });

    it('should enhance for speech recognition', async () => {
      const result = await manager.enhanceForSpeechRecognition('/input.wav', '/output.wav');

      expect(result.success).toBe(true);
      expect(mockProcessor.enhanceForSpeechRecognition).toHaveBeenCalledWith(
        '/input.wav',
        '/output.wav'
      );
    });

    it('should handle processing errors', async () => {
      mockProcessor.denoiseAudio.mockRejectedValueOnce(new Error('Processing failed'));

      await expect(manager.denoiseAudio('/input.wav', '/output.wav')).rejects.toThrow(
        'Processing failed'
      );
    });
  });

  describe('Language Detection', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should detect language', async () => {
      const result = await manager.detectLanguage('/test.wav');

      expect(result.language).toBe('zh');
      expect(result.languageName).toBe('中文');
      expect(mockRecognizer.engine.detectLanguage).toHaveBeenCalledWith('/test.wav');
    });

    it('should detect languages batch', async () => {
      mockRecognizer.engine.detectLanguages.mockResolvedValueOnce([
        { success: true, language: 'zh' },
        { success: true, language: 'en' },
      ]);

      const result = await manager.detectLanguages(['/test1.wav', '/test2.wav']);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
    });
  });

  describe('Subtitle Generation', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should generate subtitle from audio record', async () => {
      const result = await manager.generateSubtitle('audio-123', '/output.srt', 'srt');

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/subtitle.srt');
      expect(mockStorage.getAudioRecord).toHaveBeenCalledWith('audio-123');
      expect(mockSubtitleGenerator.generateFromText).toHaveBeenCalled();
    });

    it('should handle missing audio record', async () => {
      mockStorage.getAudioRecord.mockResolvedValueOnce(null);

      await expect(manager.generateSubtitle('invalid-id', '/output.srt')).rejects.toThrow(
        '未找到音频记录'
      );
    });

    it('should handle missing transcription', async () => {
      mockStorage.getAudioRecord.mockResolvedValueOnce({
        id: 'audio-123',
        transcription_text: null,
      });

      await expect(manager.generateSubtitle('audio-123', '/output.srt')).rejects.toThrow(
        '尚未转录'
      );
    });

    it('should transcribe and generate subtitle using Whisper API direct', async () => {
      mockConfig.get.mockReturnValueOnce('whisper-api');

      mockRecognizer.recognize.mockResolvedValueOnce({
        text: 'Whisper subtitle content',
        language: 'zh',
      });

      const result = await manager.transcribeAndGenerateSubtitle('/test.wav', '/output.srt', {
        format: 'srt',
        language: 'zh',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('whisper-api-direct');
      expect(mockSubtitleGenerator.saveWhisperSubtitle).toHaveBeenCalled();
    });

    it('should transcribe and generate subtitle with other engines', async () => {
      mockConfig.get.mockReturnValueOnce('whisper-local');

      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      const result = await manager.transcribeAndGenerateSubtitle('/test.wav', '/output.srt');

      expect(result.success).toBe(true);
      expect(result.method).toBe('transcribe-then-generate');
    });

    it('should enhance audio before transcription if requested', async () => {
      mockConfig.get.mockReturnValueOnce('whisper-local');

      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
      });

      await manager.transcribeAndGenerateSubtitle('/test.wav', '/output.srt', {
        enhanceAudio: true,
      });

      expect(mockProcessor.enhanceForSpeechRecognition).toHaveBeenCalled();
    });

    it('should batch generate subtitles', async () => {
      mockStorage.getAudioRecord
        .mockResolvedValueOnce({ id: 'audio-1', file_name: 'test1.wav', transcription_text: 'Text 1', duration: 30 })
        .mockResolvedValueOnce({ id: 'audio-2', file_name: 'test2.wav', transcription_text: 'Text 2', duration: 40 });

      const result = await manager.batchGenerateSubtitles(
        ['audio-1', 'audio-2'],
        '/output/dir',
        'srt'
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('ensureInitialized()', () => {
    it('should throw error if not initialized', () => {
      expect(() => manager.ensureInitialized()).toThrow('尚未初始化');
    });

    it('should not throw error if initialized', async () => {
      await manager.initialize();

      expect(() => manager.ensureInitialized()).not.toThrow();
    });
  });

  describe('terminate()', () => {
    it('should cleanup resources', async () => {
      await manager.initialize();

      const listener = vi.fn();
      manager.on('test-event', listener);

      await manager.terminate();

      manager.emit('test-event');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
