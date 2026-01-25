/**
 * Speech Manager 单元测试 (依赖注入版)
 *
 * 使用依赖注入模式实现完全的mock控制
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// ===================== MOCK SETUP =====================

// Mock UUID
vi.mock("uuid", () => ({
  v4: vi.fn(() => "mock-uuid-1234"),
}));

// Mock path
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...actual,
    basename: vi.fn((filepath) => {
      if (typeof filepath === "string") {
        return filepath.split("/").pop().split("\\").pop();
      }
      return "test.wav";
    }),
    dirname: vi.fn(() => "/mock/dir"),
    join: vi.fn((...args) => args.join("/")),
    extname: vi.fn((filepath) => {
      const match = filepath.match(/\.[^.]+$/);
      return match ? match[0] : "";
    }),
  };
});

// Import SpeechManager WITHOUT mocking its dependencies
// We'll inject mocks via constructor
const SpeechManager = require("../../src/main/speech/speech-manager");

// ===================== MOCK FACTORIES =====================

const createMockConfig = () => ({
  load: vi.fn().mockResolvedValue(true),
  getAll: vi.fn().mockReturnValue({
    defaultEngine: "whisper-api",
    audio: { segmentDuration: 600 },
    storage: { savePath: "/data/audio", keepProcessed: false },
    performance: { maxConcurrentJobs: 2 },
    knowledgeIntegration: {
      autoSaveToKnowledge: true,
      autoAddToIndex: true,
      defaultType: "note",
    },
  }),
  get: vi.fn((key) => {
    const config = {
      defaultEngine: "whisper-api",
      "audio.segmentDuration": 600,
      "storage.keepProcessed": false,
      "knowledgeIntegration.autoSaveToKnowledge": true,
      "knowledgeIntegration.autoAddToIndex": true,
      "knowledgeIntegration.defaultType": "note",
    };
    return config[key];
  }),
  set: vi.fn(),
  save: vi.fn().mockResolvedValue(true),
  getEngineConfig: vi.fn().mockReturnValue({ apiKey: "test-key" }),
  update: vi.fn().mockResolvedValue(true),
});

const createMockProcessor = () => {
  const processor = new EventEmitter();
  processor.checkFFmpeg = vi.fn().mockResolvedValue(true);
  processor.getMetadata = vi.fn().mockResolvedValue({
    duration: 120.5,
    format: "mp3",
    sampleRate: 44100,
    channels: 2,
  });
  processor.segmentAudio = vi
    .fn()
    .mockResolvedValue(["/audio1.wav", "/audio2.wav"]);
  processor.convertToWhisperFormat = vi
    .fn()
    .mockResolvedValue({ outputPath: "/converted.wav" });
  processor.cleanupTempFiles = vi.fn().mockResolvedValue(true);
  processor.denoiseAudio = vi
    .fn()
    .mockResolvedValue({ success: true, outputPath: "/denoised.wav" });
  processor.enhanceAudio = vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/enhanced.wav",
    appliedFilters: 3,
  });
  processor.enhanceForSpeechRecognition = vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/enhanced-speech.wav",
  });
  return processor;
};

const createMockStorage = () => ({
  initialize: vi.fn().mockResolvedValue(true),
  saveAudioFile: vi.fn().mockResolvedValue({ id: "audio-123" }),
  addTranscriptionHistory: vi.fn().mockResolvedValue({ id: "history-123" }),
  updateAudioRecord: vi.fn().mockResolvedValue(true),
  getAudioRecord: vi.fn().mockResolvedValue({
    id: "audio-123",
    file_name: "test.wav",
    duration: 120.5,
    transcription_text: "Test transcription",
  }),
  getAllTranscriptionHistory: vi.fn().mockResolvedValue([]),
  deleteTranscriptionHistory: vi.fn().mockResolvedValue(true),
  getAllAudioFiles: vi.fn().mockResolvedValue([]),
  searchAudioFiles: vi.fn().mockResolvedValue([]),
  deleteAudioFile: vi.fn().mockResolvedValue(true),
  getStats: vi.fn().mockResolvedValue({ total: 10, duration: 1200 }),
});

const createMockRecognizer = () => ({
  recognize: vi.fn().mockResolvedValue({
    success: true,
    text: "This is a test transcription.",
    language: "zh",
    confidence: 0.95,
  }),
  switchEngine: vi.fn(),
  getAvailableEngines: vi.fn().mockResolvedValue([]),
  engine: {
    detectLanguage: vi.fn().mockResolvedValue({
      success: true,
      language: "zh",
      languageName: "中文",
      confidence: 0.9,
    }),
    detectLanguages: vi.fn().mockResolvedValue([]),
  },
});

const createMockSubtitleGenerator = () => ({
  generateFromText: vi.fn().mockReturnValue([
    { index: 1, start: "00:00:00,000", end: "00:00:05,000", text: "Line 1" },
    { index: 2, start: "00:00:05,000", end: "00:00:10,000", text: "Line 2" },
  ]),
  saveSubtitleFile: vi
    .fn()
    .mockResolvedValue({ success: true, outputPath: "/subtitle.srt" }),
  saveWhisperSubtitle: vi.fn().mockResolvedValue({ success: true }),
});

// ===================== TESTS =====================

describe("SpeechManager with Dependency Injection", () => {
  let manager;
  let mockDb;
  let mockRagManager;
  let mockConfig;
  let mockProcessor;
  let mockStorage;
  let mockRecognizer;
  let mockSubtitleGenerator;

  beforeEach(() => {
    // Create fresh mock instances
    mockConfig = createMockConfig();
    mockProcessor = createMockProcessor();
    mockStorage = createMockStorage();
    mockRecognizer = createMockRecognizer();
    mockSubtitleGenerator = createMockSubtitleGenerator();

    // Create mock database
    mockDb = {
      addKnowledgeItem: vi.fn().mockResolvedValue({ id: "knowledge-123" }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
      exec: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock RAG manager
    mockRagManager = {
      addToIndex: vi.fn().mockResolvedValue(true),
    };

    // Create manager with injected dependencies
    manager = new SpeechManager(mockDb, mockRagManager, {
      ConfigClass: vi.fn(() => mockConfig),
      ProcessorClass: vi.fn(() => mockProcessor),
      StorageClass: vi.fn(() => mockStorage),
      RecognizerClass: vi.fn(() => mockRecognizer),
      SubtitleClass: vi.fn(() => mockSubtitleGenerator),
    });
  });

  afterEach(() => {
    if (manager) {
      manager.removeAllListeners();
    }
  });

  describe("构造函数", () => {
    it("should create instance with database", () => {
      expect(manager).toBeInstanceOf(SpeechManager);
      expect(manager.db).toBe(mockDb);
      expect(manager.initialized).toBe(false);
    });

    it("should create instance with optional RAG manager", () => {
      const managerWithoutRag = new SpeechManager(mockDb);
      expect(managerWithoutRag.ragManager).toBeNull();
    });

    it("should initialize task queue", () => {
      expect(manager.taskQueue).toEqual([]);
      expect(manager.runningTasks).toBe(0);
      // maxConcurrentTasks is dynamically calculated based on CPU cores (min 1, max 4)
      expect(manager.maxConcurrentTasks).toBeGreaterThanOrEqual(1);
      expect(manager.maxConcurrentTasks).toBeLessThanOrEqual(4);
    });

    it("should store injected dependencies", () => {
      expect(manager.dependencies.ConfigClass).toBeDefined();
      expect(manager.dependencies.ProcessorClass).toBeDefined();
      expect(manager.dependencies.StorageClass).toBeDefined();
      expect(manager.dependencies.RecognizerClass).toBeDefined();
      expect(manager.dependencies.SubtitleClass).toBeDefined();
    });
  });

  describe("initialize()", () => {
    it("should initialize all submodules", async () => {
      const result = await manager.initialize();

      expect(result).toBe(true);
      expect(manager.initialized).toBe(true);
      expect(mockConfig.load).toHaveBeenCalled();
      expect(mockProcessor.checkFFmpeg).toHaveBeenCalled();
      expect(mockStorage.initialize).toHaveBeenCalled();
    });

    it("should set maxConcurrentTasks from config", async () => {
      mockConfig.getAll.mockReturnValueOnce({
        defaultEngine: "whisper-api",
        audio: {},
        storage: { savePath: "/data" },
        performance: { maxConcurrentJobs: 5 },
        knowledgeIntegration: {},
      });

      await manager.initialize();

      expect(manager.maxConcurrentTasks).toBe(5);
    });

    it("should handle FFmpeg not available", async () => {
      mockProcessor.checkFFmpeg.mockResolvedValueOnce(false);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await manager.initialize();

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("FFmpeg 不可用"),
      );

      consoleSpy.mockRestore();
    });

    it("should return false on initialization error", async () => {
      mockConfig.load.mockRejectedValueOnce(new Error("Config load failed"));

      const result = await manager.initialize();

      expect(result).toBe(false);
      expect(manager.initialized).toBe(false);
    });

    it("should use injected config class", async () => {
      const ConfigClassSpy = vi.fn(() => mockConfig);

      const testManager = new SpeechManager(mockDb, mockRagManager, {
        ConfigClass: ConfigClassSpy,
        ProcessorClass: vi.fn(() => mockProcessor),
        StorageClass: vi.fn(() => mockStorage),
        RecognizerClass: vi.fn(() => mockRecognizer),
        SubtitleClass: vi.fn(() => mockSubtitleGenerator),
      });

      await testManager.initialize();

      expect(ConfigClassSpy).toHaveBeenCalled();
      expect(testManager.config).toBe(mockConfig);
    });
  });

  describe("setupProcessorEvents()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should forward convert events", () => {
      const convertStartSpy = vi.fn();
      const convertProgressSpy = vi.fn();
      const convertCompleteSpy = vi.fn();
      const convertErrorSpy = vi.fn();

      manager.on("process:convert-start", convertStartSpy);
      manager.on("process:convert-progress", convertProgressSpy);
      manager.on("process:convert-complete", convertCompleteSpy);
      manager.on("process:convert-error", convertErrorSpy);

      mockProcessor.emit("convert-start", { file: "test.wav" });
      mockProcessor.emit("convert-progress", { percent: 50 });
      mockProcessor.emit("convert-complete", { success: true });
      mockProcessor.emit("convert-error", { error: "Failed" });

      expect(convertStartSpy).toHaveBeenCalledWith({ file: "test.wav" });
      expect(convertProgressSpy).toHaveBeenCalledWith({ percent: 50 });
      expect(convertCompleteSpy).toHaveBeenCalledWith({ success: true });
      expect(convertErrorSpy).toHaveBeenCalledWith({ error: "Failed" });
    });

    it("should forward batch events", () => {
      const batchProgressSpy = vi.fn();
      const batchCompleteSpy = vi.fn();

      manager.on("process:batch-progress", batchProgressSpy);
      manager.on("process:batch-complete", batchCompleteSpy);

      mockProcessor.emit("batch-progress", { current: 5 });
      mockProcessor.emit("batch-complete", { total: 10 });

      expect(batchProgressSpy).toHaveBeenCalledWith({ current: 5 });
      expect(batchCompleteSpy).toHaveBeenCalledWith({ total: 10 });
    });
  });

  describe("transcribeFile()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should transcribe audio file successfully", async () => {
      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      });

      const result = await manager.transcribeFile("/test.wav");

      expect(result.success).toBe(true);
      expect(result.text).toBe("This is a test transcription.");
      expect(result.engine).toBe("whisper-api");
      expect(mockRecognizer.recognize).toHaveBeenCalled();
      expect(mockStorage.saveAudioFile).toHaveBeenCalled();
    });

    it("should emit transcribe events", async () => {
      const startSpy = vi.fn();
      const progressSpy = vi.fn();
      const completeSpy = vi.fn();

      manager.on("transcribe-start", startSpy);
      manager.on("transcribe-progress", progressSpy);
      manager.on("transcribe-complete", completeSpy);

      mockProcessor.getMetadata.mockResolvedValueOnce({
        duration: 30.0,
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      });

      await manager.transcribeFile("/test.wav");

      expect(startSpy).toHaveBeenCalled();
      expect(progressSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it("should throw error if not initialized", async () => {
      const uninitializedManager = new SpeechManager(mockDb);

      await expect(
        uninitializedManager.transcribeFile("/test.wav"),
      ).rejects.toThrow("尚未初始化");
    });
  });

  describe("Config Management", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should get config", async () => {
      const config = await manager.getConfig();

      expect(config).toBeDefined();
      expect(mockConfig.getAll).toHaveBeenCalled();
    });

    it("should update config", async () => {
      const newConfig = { defaultEngine: "whisper-local" };

      await manager.updateConfig(newConfig);

      expect(mockConfig.update).toHaveBeenCalledWith(newConfig);
    });

    it("should set engine", async () => {
      const result = await manager.setEngine("whisper-local");

      expect(result.success).toBe(true);
      expect(result.engine).toBe("whisper-local");
      expect(mockRecognizer.switchEngine).toHaveBeenCalled();
      expect(mockConfig.save).toHaveBeenCalled();
    });

    it("should get available engines", async () => {
      await manager.getAvailableEngines();

      expect(mockRecognizer.getAvailableEngines).toHaveBeenCalled();
    });
  });

  describe("ensureInitialized()", () => {
    it("should throw error if not initialized", () => {
      expect(() => manager.ensureInitialized()).toThrow("尚未初始化");
    });

    it("should not throw error if initialized", async () => {
      await manager.initialize();

      expect(() => manager.ensureInitialized()).not.toThrow();
    });
  });

  describe("terminate()", () => {
    it("should cleanup resources", async () => {
      await manager.initialize();

      const listener = vi.fn();
      manager.on("test-event", listener);

      await manager.terminate();

      manager.emit("test-event");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("Backward Compatibility", () => {
    it("should work without dependency injection (use defaults)", () => {
      const defaultManager = new SpeechManager(mockDb);

      expect(defaultManager.dependencies.ConfigClass).toBeDefined();
      expect(defaultManager.dependencies.ProcessorClass).toBeDefined();
      expect(defaultManager.dependencies.StorageClass).toBeDefined();
      expect(defaultManager.dependencies.RecognizerClass).toBeDefined();
      expect(defaultManager.dependencies.SubtitleClass).toBeDefined();
    });
  });
});
