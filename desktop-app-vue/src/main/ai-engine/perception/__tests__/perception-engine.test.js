import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { PerceptionEngine } = require("../perception-engine");

describe("PerceptionEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new PerceptionEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start uninitialized", () => {
    expect(engine.initialized).toBe(false);
    expect(engine._context.size).toBe(0);
    expect(engine._voiceSessions.size).toBe(0);
  });

  it("should initialize with database", async () => {
    await engine.initialize(db);
    expect(engine.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await engine.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await engine.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Screen Analysis ---

  it("should analyze a screenshot", async () => {
    await engine.initialize(db);
    const result = await engine.analyzeScreen("/path/to/screenshot.png");
    expect(result.type).toBe("screen");
    expect(result.inputPath).toBe("/path/to/screenshot.png");
    expect(result.elements).toHaveLength(2);
    expect(result.confidence).toBe(0.85);
  });

  it("should emit perception:screen-analyzed event", async () => {
    await engine.initialize(db);
    const handler = vi.fn();
    engine.on("perception:screen-analyzed", handler);
    await engine.analyzeScreen("/path/screenshot.png");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ elements: 2 }),
    );
  });

  it("should add screen analysis to context", async () => {
    await engine.initialize(db);
    await engine.analyzeScreen("/path/screenshot.png");
    const ctx = engine.getContext("visual");
    expect(ctx.length).toBe(1);
    expect(ctx[0].modality).toBe("visual");
  });

  // --- Voice ---

  it("should start a voice session", async () => {
    await engine.initialize(db);
    const result = await engine.startVoice("voice-1", { language: "en" });
    expect(result.sessionId).toBe("voice-1");
    expect(result.status).toBe("active");
    expect(engine._voiceSessions.has("voice-1")).toBe(true);
  });

  it("should auto-generate voice session id", async () => {
    await engine.initialize(db);
    const result = await engine.startVoice(null);
    expect(result.sessionId).toMatch(/^voice-/);
  });

  it("should stop a voice session", async () => {
    await engine.initialize(db);
    await engine.startVoice("voice-1");
    const result = await engine.stopVoice("voice-1");
    expect(result.sessionId).toBe("voice-1");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty("transcriptions");
  });

  it("should return null when stopping unknown voice session", async () => {
    await engine.initialize(db);
    expect(await engine.stopVoice("no-session")).toBeNull();
  });

  // --- Document Parsing ---

  it("should parse a supported document format", async () => {
    await engine.initialize(db);
    const result = await engine.parseDocument("/path/to/file.pdf");
    expect(result.type).toBe("document");
    expect(result.format).toBe("pdf");
    expect(result.confidence).toBe(0.9);
  });

  it("should return error for unsupported document format", async () => {
    await engine.initialize(db);
    const result = await engine.parseDocument("/path/to/file.xyz");
    expect(result.error).toContain("Unsupported format");
    expect(result.confidence).toBe(0);
  });

  it("should support all listed formats", async () => {
    await engine.initialize(db);
    for (const fmt of ["pdf", "pptx", "xlsx", "docx", "csv", "txt"]) {
      const result = await engine.parseDocument(`/path/file.${fmt}`);
      expect(result.format).toBe(fmt);
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  // --- Video Analysis ---

  it("should analyze a supported video format", async () => {
    await engine.initialize(db);
    const result = await engine.analyzeVideo("/path/video.mp4");
    expect(result.type).toBe("video");
    expect(result.confidence).toBe(0.8);
  });

  it("should return error for unsupported video format", async () => {
    await engine.initialize(db);
    const result = await engine.analyzeVideo("/path/video.flv");
    expect(result.error).toContain("Unsupported format");
    expect(result.confidence).toBe(0);
  });

  // --- Cross-modal Query ---

  it("should query across modalities", async () => {
    await engine.initialize(db);
    await engine.analyzeScreen("/path/screen.png");
    await engine.parseDocument("/path/doc.pdf");
    const results = await engine.crossModalQuery("test");
    expect(results.length).toBe(2);
  });

  it("should filter by specific modalities", async () => {
    await engine.initialize(db);
    await engine.analyzeScreen("/path/screen.png");
    await engine.parseDocument("/path/doc.pdf");
    const results = await engine.crossModalQuery("test", ["visual"]);
    expect(results.every((r) => r.modality === "visual")).toBe(true);
  });

  // --- Context ---

  it("should return all context without modality filter", async () => {
    await engine.initialize(db);
    await engine.analyzeScreen("/path/screen.png");
    await engine.parseDocument("/path/doc.pdf");
    const ctx = engine.getContext();
    expect(ctx.length).toBe(2);
  });

  it("should filter context by modality", async () => {
    await engine.initialize(db);
    await engine.analyzeScreen("/path/screen.png");
    await engine.parseDocument("/path/doc.pdf");
    const ctx = engine.getContext("document");
    expect(ctx.length).toBe(1);
    expect(ctx[0].modality).toBe("document");
  });

  // --- Configure ---

  it("should update configuration", async () => {
    await engine.initialize(db);
    const result = engine.configure({ maxContextItems: 200 });
    expect(result.maxContextItems).toBe(200);
  });

  it("should emit perception:configured event", async () => {
    await engine.initialize(db);
    const handler = vi.fn();
    engine.on("perception:configured", handler);
    engine.configure({ cacheTimeout: 120000 });
    expect(handler).toHaveBeenCalled();
  });
});
