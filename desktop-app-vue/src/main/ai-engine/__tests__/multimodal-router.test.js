/**
 * MultimodalRouter 单元测试
 *
 * 覆盖：initialize、detectInputType、processInput、analyzeImage、
 *       transcribeAudio、analyzeVideo、multimodalChat、getCapabilities、
 *       getSession、listSessions、deleteSession、configure、
 *       checkHealth、getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-1234"),
}));

const {
  MultimodalRouter,
  ModalityTypes,
  EXTENSION_MAP,
} = require("../multimodal-router");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    _prep: prepResult,
  };
}

function createMockVisionManager() {
  return {
    analyzeImage: vi.fn().mockResolvedValue({ text: "A beautiful sunset" }),
  };
}

function createMockLLMManager() {
  return {
    query: vi.fn().mockResolvedValue({ text: "response" }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MultimodalRouter", () => {
  let router;
  let mockDb;
  let mockVision;
  let mockLLM;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockVision = createMockVisionManager();
    mockLLM = createMockLLMManager();
    router = new MultimodalRouter({
      visionManager: mockVision,
      llmManager: mockLLM,
      database: mockDb,
    });
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor & constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("ModalityTypes constants", () => {
    it("should export expected modality types", () => {
      expect(ModalityTypes.IMAGE).toBe("image");
      expect(ModalityTypes.AUDIO).toBe("audio");
      expect(ModalityTypes.VIDEO).toBe("video");
      expect(ModalityTypes.TEXT).toBe("text");
    });
  });

  describe("EXTENSION_MAP", () => {
    it("should map image extensions correctly", () => {
      expect(EXTENSION_MAP[".jpg"]).toBe(ModalityTypes.IMAGE);
      expect(EXTENSION_MAP[".png"]).toBe(ModalityTypes.IMAGE);
      expect(EXTENSION_MAP[".webp"]).toBe(ModalityTypes.IMAGE);
    });

    it("should map audio extensions correctly", () => {
      expect(EXTENSION_MAP[".mp3"]).toBe(ModalityTypes.AUDIO);
      expect(EXTENSION_MAP[".wav"]).toBe(ModalityTypes.AUDIO);
      expect(EXTENSION_MAP[".flac"]).toBe(ModalityTypes.AUDIO);
    });

    it("should map video extensions correctly", () => {
      expect(EXTENSION_MAP[".mp4"]).toBe(ModalityTypes.VIDEO);
      expect(EXTENSION_MAP[".avi"]).toBe(ModalityTypes.VIDEO);
      expect(EXTENSION_MAP[".mkv"]).toBe(ModalityTypes.VIDEO);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create DB tables and set initialized=true", async () => {
      await router.initialize();

      expect(mockDb.db.exec).toHaveBeenCalledTimes(2);
      expect(router.initialized).toBe(true);
    });

    it("should detect vision capabilities when visionManager is present", async () => {
      await router.initialize();

      const caps = router.getCapabilities();
      expect(caps[ModalityTypes.IMAGE].available).toBe(true);
      expect(caps[ModalityTypes.IMAGE].provider).toBe("vision-manager");
      expect(caps[ModalityTypes.VIDEO].available).toBe(true);
    });

    it("should set audio capability available", async () => {
      await router.initialize();

      const caps = router.getCapabilities();
      expect(caps[ModalityTypes.AUDIO].available).toBe(true);
    });

    it("should always have text capability", () => {
      const caps = router.getCapabilities();
      expect(caps[ModalityTypes.TEXT].available).toBe(true);
      expect(caps[ModalityTypes.TEXT].provider).toBe("llm");
    });

    it("should work without visionManager", async () => {
      const noVision = new MultimodalRouter({
        visionManager: null,
        llmManager: mockLLM,
        database: mockDb,
      });
      await noVision.initialize();

      const caps = noVision.getCapabilities();
      expect(caps[ModalityTypes.IMAGE].available).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // detectInputType
  // ─────────────────────────────────────────────────────────────────────────
  describe("detectInputType()", () => {
    it("should detect image from .jpg extension", () => {
      expect(router.detectInputType("/path/to/photo.jpg")).toBe(
        ModalityTypes.IMAGE,
      );
    });

    it("should detect audio from .mp3 extension", () => {
      expect(router.detectInputType("/path/to/song.mp3")).toBe(
        ModalityTypes.AUDIO,
      );
    });

    it("should detect video from .mp4 extension", () => {
      expect(router.detectInputType("/path/to/video.mp4")).toBe(
        ModalityTypes.VIDEO,
      );
    });

    it("should return TEXT for unknown extensions", () => {
      expect(router.detectInputType("/path/to/file.txt")).toBe(
        ModalityTypes.TEXT,
      );
      expect(router.detectInputType("/path/to/file.pdf")).toBe(
        ModalityTypes.TEXT,
      );
    });

    it("should return TEXT for null input", () => {
      expect(router.detectInputType(null)).toBe(ModalityTypes.TEXT);
    });

    it("should be case-insensitive for extensions", () => {
      expect(router.detectInputType("/path/to/photo.JPG")).toBe(
        ModalityTypes.IMAGE,
      );
      expect(router.detectInputType("/path/to/video.MP4")).toBe(
        ModalityTypes.VIDEO,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // processInput
  // ─────────────────────────────────────────────────────────────────────────
  describe("processInput()", () => {
    it("should route image inputs to analyzeImage", async () => {
      const spy = vi
        .spyOn(router, "analyzeImage")
        .mockResolvedValue({ type: "image" });

      await router.processInput({ filePath: "/img.png", prompt: "describe" });

      expect(spy).toHaveBeenCalledWith("/img.png", "describe");
    });

    it("should route audio inputs to transcribeAudio", async () => {
      const spy = vi
        .spyOn(router, "transcribeAudio")
        .mockResolvedValue({ type: "audio" });

      await router.processInput({
        filePath: "/audio.mp3",
        prompt: "transcribe",
      });

      expect(spy).toHaveBeenCalledWith("/audio.mp3", { prompt: "transcribe" });
    });

    it("should route video inputs to analyzeVideo", async () => {
      const spy = vi
        .spyOn(router, "analyzeVideo")
        .mockResolvedValue({ type: "video" });

      await router.processInput({
        filePath: "/video.mp4",
        prompt: "summarize",
      });

      expect(spy).toHaveBeenCalledWith("/video.mp4", "summarize");
    });

    it("should use explicit type override", async () => {
      const spy = vi
        .spyOn(router, "analyzeImage")
        .mockResolvedValue({ type: "image" });

      await router.processInput({
        filePath: "/mystery.bin",
        type: "image",
        prompt: "test",
      });

      expect(spy).toHaveBeenCalled();
    });

    it("should return text result for text input", async () => {
      const result = await router.processInput({
        filePath: null,
        prompt: "hello",
      });

      expect(result).toEqual({ type: ModalityTypes.TEXT, result: "hello" });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzeImage
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzeImage()", () => {
    it("should call visionManager.analyzeImage and return result", async () => {
      mockVision.analyzeImage.mockResolvedValue({ text: "A cat" });

      const result = await router.analyzeImage("/cat.jpg", "What is this?");

      expect(mockVision.analyzeImage).toHaveBeenCalledWith("/cat.jpg", {
        prompt: "What is this?",
        type: "analyze",
      });
      expect(result.type).toBe(ModalityTypes.IMAGE);
      expect(result.result).toEqual({ text: "A cat" });
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toBeTruthy();
      expect(typeof result.duration).toBe("number");
    });

    it("should use default prompt when none provided", async () => {
      mockVision.analyzeImage.mockResolvedValue({ text: "An image" });

      await router.analyzeImage("/img.png");

      expect(mockVision.analyzeImage).toHaveBeenCalledWith(
        "/img.png",
        expect.objectContaining({ prompt: "Describe this image" }),
      );
    });

    it("should return fallback result when no visionManager", async () => {
      const noVision = new MultimodalRouter({
        visionManager: null,
        llmManager: mockLLM,
        database: mockDb,
      });

      const result = await noVision.analyzeImage("/img.png", "describe");

      expect(result.result.text).toContain("not available");
    });

    it("should emit analysis-complete event", async () => {
      const emitSpy = vi.spyOn(router, "emit");
      mockVision.analyzeImage.mockResolvedValue({ text: "test" });

      await router.analyzeImage("/img.png", "test");

      expect(emitSpy).toHaveBeenCalledWith(
        "analysis-complete",
        expect.any(Object),
      );
    });

    it("should save session to database", async () => {
      mockVision.analyzeImage.mockResolvedValue({ text: "result" });

      await router.analyzeImage("/img.png", "test");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO multimodal_sessions"),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // transcribeAudio
  // ─────────────────────────────────────────────────────────────────────────
  describe("transcribeAudio()", () => {
    it("should return transcription result", async () => {
      const result = await router.transcribeAudio("/audio.mp3", {
        language: "en",
      });

      expect(result.type).toBe(ModalityTypes.AUDIO);
      expect(result.result.language).toBe("en");
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toBeTruthy();
    });

    it("should use default auto language", async () => {
      const result = await router.transcribeAudio("/audio.mp3");

      expect(result.result.language).toBe("auto");
    });

    it("should emit transcription-complete event", async () => {
      const emitSpy = vi.spyOn(router, "emit");

      await router.transcribeAudio("/audio.mp3");

      expect(emitSpy).toHaveBeenCalledWith(
        "transcription-complete",
        expect.any(Object),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzeVideo
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzeVideo()", () => {
    it("should return video analysis result", async () => {
      const result = await router.analyzeVideo("/video.mp4", "Summarize");

      expect(result.type).toBe(ModalityTypes.VIDEO);
      expect(result.result.prompt).toBe("Summarize");
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toBeTruthy();
    });

    it("should emit video-analysis-complete event", async () => {
      const emitSpy = vi.spyOn(router, "emit");

      await router.analyzeVideo("/video.mp4");

      expect(emitSpy).toHaveBeenCalledWith(
        "video-analysis-complete",
        expect.any(Object),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // multimodalChat
  // ─────────────────────────────────────────────────────────────────────────
  describe("multimodalChat()", () => {
    it("should process image messages", async () => {
      const spy = vi
        .spyOn(router, "analyzeImage")
        .mockResolvedValue({ type: "image" });

      await router.multimodalChat([{ image: "/img.png", text: "describe" }]);

      expect(spy).toHaveBeenCalledWith("/img.png", "describe");
    });

    it("should process audio messages", async () => {
      const spy = vi
        .spyOn(router, "transcribeAudio")
        .mockResolvedValue({ type: "audio" });

      await router.multimodalChat([{ audio: "/sound.mp3" }]);

      expect(spy).toHaveBeenCalledWith("/sound.mp3");
    });

    it("should process video messages", async () => {
      const spy = vi
        .spyOn(router, "analyzeVideo")
        .mockResolvedValue({ type: "video" });

      await router.multimodalChat([{ video: "/clip.mp4", text: "summarize" }]);

      expect(spy).toHaveBeenCalledWith("/clip.mp4", "summarize");
    });

    it("should process text messages directly", async () => {
      const result = await router.multimodalChat([{ text: "hello" }]);

      expect(result.messages[0]).toEqual({ type: "text", result: "hello" });
    });

    it("should handle mixed message types", async () => {
      vi.spyOn(router, "analyzeImage").mockResolvedValue({ type: "image" });

      const result = await router.multimodalChat([
        { image: "/img.png", text: "describe" },
        { text: "hello world" },
      ]);

      expect(result.messages).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSession / listSessions / deleteSession
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSession()", () => {
    it("should return null when session not found", async () => {
      mockDb.db._prep.get.mockReturnValueOnce(null);

      const result = await router.getSession("non-existent");

      expect(result).toBeNull();
    });

    it("should parse result JSON from DB row", async () => {
      mockDb.db._prep.get.mockReturnValueOnce({
        id: "s1",
        type: "image",
        result: JSON.stringify({ text: "cat" }),
      });

      const result = await router.getSession("s1");

      expect(result.result).toEqual({ text: "cat" });
    });
  });

  describe("listSessions()", () => {
    it("should return empty list when no sessions", async () => {
      mockDb.db._prep.all.mockReturnValueOnce([]);
      mockDb.db._prep.get.mockReturnValueOnce({ total: 0 });

      const result = await router.listSessions();

      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should return sessions with pagination", async () => {
      const rows = [
        { id: "s1", type: "image", result: JSON.stringify({ text: "a" }) },
      ];
      mockDb.db._prep.all.mockReturnValueOnce(rows);
      mockDb.db._prep.get.mockReturnValueOnce({ total: 1 });

      const result = await router.listSessions({ limit: 10, offset: 0 });

      expect(result.sessions).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("deleteSession()", () => {
    it("should return true when session deleted", async () => {
      mockDb.db._prep.run.mockReturnValueOnce({ changes: 1 });

      const result = await router.deleteSession("s1");

      expect(result).toBe(true);
    });

    it("should return false when session not found", async () => {
      mockDb.db._prep.run.mockReturnValueOnce({ changes: 0 });

      const result = await router.deleteSession("non-existent");

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("configure()", () => {
    it("should update capability settings", async () => {
      await router.initialize();

      const result = await router.configure("image", { provider: "openai" });

      expect(result.provider).toBe("openai");
    });

    it("should return null for unknown modality", async () => {
      const result = await router.configure("unknown-modality", {});

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // checkHealth
  // ─────────────────────────────────────────────────────────────────────────
  describe("checkHealth()", () => {
    it("should return health status for all modalities", async () => {
      await router.initialize();
      const health = await router.checkHealth();

      expect(health).toHaveProperty("image");
      expect(health).toHaveProperty("audio");
      expect(health).toHaveProperty("video");
      expect(health).toHaveProperty("text");
      expect(health.text.status).toBe("healthy");
    });

    it("should show unavailable status for unconfigured modalities", async () => {
      const noVision = new MultimodalRouter({
        visionManager: null,
        llmManager: mockLLM,
        database: mockDb,
      });

      const health = await noVision.checkHealth();

      expect(health.image.status).toBe("unavailable");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return stats with capabilities", async () => {
      mockDb.db._prep.all.mockReturnValueOnce([
        { type: "image", count: 5, avg_duration: 200, total_duration: 1000 },
      ]);
      await router.initialize();

      const stats = await router.getStats();

      expect(stats.byType).toHaveLength(1);
      expect(stats.capabilities).toBeDefined();
    });
  });
});
