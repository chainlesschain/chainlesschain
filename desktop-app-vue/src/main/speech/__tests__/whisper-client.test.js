/**
 * WhisperClient Tests
 *
 * Comprehensive test suite for WhisperClient:
 * - Constructor defaults
 * - Transcription in API mode (mock axios)
 * - Transcription in local mode (mock child_process.spawn)
 * - _parseWhisperOutput
 * - listModels (mock fs)
 * - startStream and stopStream
 * - voiceChat pipeline
 * - Edge cases: missing audio file, invalid model size
 *
 * Uses _deps injection pattern to override fs and spawn in the source module.
 * This avoids vitest CJS/ESM mock interop issues with Node.js built-in modules.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Mock non-built-in dependencies via vi.mock
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/userData") },
}));

// Import the module under test. _deps is a mutable object whose properties
// (fs, spawn) we can replace before each test. The source code uses _deps.fs
// and _deps.spawn internally, so our overrides take effect immediately.
const { WhisperClient, _deps } = await import("../whisper-client");

/**
 * Helper: create a mock child process (EventEmitter with stdin/stdout/stderr)
 */
function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn(), destroyed: false };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    setTimeout(() => proc.emit("close", 0), 10);
  });
  return proc;
}

// ============================================================
// Test Suite
// ============================================================

describe("WhisperClient", () => {
  let client;

  // Mock fs and spawn that we inject into _deps before each test
  let mockFs;
  let mockSpawn;
  let mockAxiosPost;

  beforeEach(() => {
    // Create fresh mock functions
    mockSpawn = vi.fn();
    mockAxiosPost = vi.fn();

    // Create a createReadStream that returns a minimal readable-stream-like object
    // compatible with form-data (needs .on, .pipe, .pause, .resume)
    const mockCreateReadStream = vi.fn().mockImplementation(() => {
      const stream = new EventEmitter();
      stream.pipe = vi.fn().mockReturnValue(stream);
      stream.pause = vi.fn();
      stream.resume = vi.fn();
      stream.readable = true;
      stream.path = "/audio.wav";
      return stream;
    });

    mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      accessSync: vi.fn().mockReturnValue(undefined),
      mkdirSync: vi.fn(),
      statSync: vi.fn().mockReturnValue({ size: 142000000 }),
      createReadStream: mockCreateReadStream,
      createWriteStream: vi.fn().mockImplementation(() => {
        const w = new EventEmitter();
        w.destroy = vi.fn();
        return w;
      }),
      unlinkSync: vi.fn(),
      renameSync: vi.fn(),
      constants: { F_OK: 0 },
    };

    // Override _deps so the source module uses our mocks
    _deps.fs = mockFs;
    _deps.spawn = mockSpawn;
    _deps.uuidv4 = vi.fn(() => "test-uuid-1234");
    _deps.getAxios = () => ({ post: mockAxiosPost });

    client = new WhisperClient();
  });

  afterEach(async () => {
    if (client) {
      await client.terminate();
    }
  });

  // ============================================================
  // Constructor Tests
  // ============================================================

  describe("constructor", () => {
    it("should use default values when no config provided", () => {
      const c = new WhisperClient();
      expect(c.mode).toBe("local");
      expect(c.modelSize).toBe("base");
      expect(c.language).toBe("auto");
      expect(c.apiBaseURL).toBe("https://api.openai.com/v1");
      expect(c.stats.totalTranscriptions).toBe(0);
      c.removeAllListeners();
    });

    it("should accept custom configuration", () => {
      const c = new WhisperClient({
        mode: "api",
        modelSize: "large",
        language: "zh",
        apiKey: "sk-test-key",
        apiBaseURL: "https://custom-api.example.com/v1",
        binaryPath: "/usr/local/bin/whisper",
        modelPath: "/models/ggml-large.bin",
      });
      expect(c.mode).toBe("api");
      expect(c.modelSize).toBe("large");
      expect(c.language).toBe("zh");
      expect(c.apiKey).toBe("sk-test-key");
      expect(c.apiBaseURL).toBe("https://custom-api.example.com/v1");
      expect(c.binaryPath).toBe("/usr/local/bin/whisper");
      expect(c.modelPath).toBe("/models/ggml-large.bin");
      c.removeAllListeners();
    });

    it("should initialize empty active streams map", () => {
      expect(client.activeStreams.size).toBe(0);
    });

    it("should initialize stats to zero", () => {
      expect(client.stats).toEqual({
        totalTranscriptions: 0,
        totalDuration: 0,
        totalCharacters: 0,
        errors: 0,
        byMode: { local: 0, api: 0 },
      });
    });
  });

  // ============================================================
  // Transcribe - Local Mode
  // ============================================================

  describe("transcribe (local mode)", () => {
    it("should transcribe audio using whisper.cpp", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const whisperOutput = JSON.stringify({
        transcription: [
          { timestamps: { from: "00:00:00.000", to: "00:00:02.500" }, text: "Hello world" },
          { timestamps: { from: "00:00:02.500", to: "00:00:05.000" }, text: "This is a test" },
        ],
      });
      const promise = client.transcribe("/path/to/audio.wav");
      mockProc.stdout.emit("data", Buffer.from(whisperOutput));
      mockProc.emit("close", 0);
      const result = await promise;
      expect(result.text).toBe("Hello world This is a test");
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].start).toBe(0);
      expect(result.segments[0].end).toBe(2.5);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it("should pass correct arguments to whisper.cpp", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const c = new WhisperClient({ mode: "local", language: "en", modelPath: "/models/test.bin", binaryPath: "/usr/bin/whisper" });
      const promise = c.transcribe("/audio.wav", { prompt: "test prompt", temperature: 0.5 });
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      await promise;
      expect(mockSpawn).toHaveBeenCalledWith("/usr/bin/whisper", [
        "--model", "/models/test.bin", "--output-json", "-f", "/audio.wav",
        "--language", "en", "--prompt", "test prompt", "--temperature", "0.5",
      ]);
      await c.terminate();
    });

    it("should throw error when audio file does not exist", async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(client.transcribe("/nonexistent/audio.wav")).rejects.toThrow("Audio file not found");
    });

    it("should throw error when whisper.cpp exits with non-zero code", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.transcribe("/path/to/audio.wav");
      mockProc.stderr.emit("data", Buffer.from("model file not found"));
      mockProc.emit("close", 1);
      await expect(promise).rejects.toThrow("model file not found");
      expect(client.stats.errors).toBe(1);
    });

    it("should throw error when whisper.cpp fails to spawn", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockProc.emit("error", new Error("ENOENT")));
        return mockProc;
      });
      await expect(client.transcribe("/path/to/audio.wav")).rejects.toThrow("Failed to start whisper.cpp");
      expect(client.stats.errors).toBe(1);
    });

    it("should throw error when model file does not exist", async () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      await expect(client.transcribe("/audio.wav")).rejects.toThrow("Whisper model not found");
    });

    it("should fallback to plain text on parse error", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.transcribe("/audio.wav");
      mockProc.stdout.emit("data", Buffer.from("Just plain text output"));
      mockProc.emit("close", 0);
      const result = await promise;
      expect(result.text).toBe("Just plain text output");
      expect(result.segments).toEqual([]);
    });

    it("should update statistics after successful transcription", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.transcribe("/audio.wav");
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "hello", duration: 2.5 })));
      mockProc.emit("close", 0);
      await promise;
      expect(client.stats.totalTranscriptions).toBe(1);
      expect(client.stats.totalCharacters).toBe(5);
      expect(client.stats.totalDuration).toBe(2.5);
      expect(client.stats.byMode.local).toBe(1);
    });

    it("should emit transcription:complete event", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const handler = vi.fn();
      client.on("transcription:complete", handler);
      const promise = client.transcribe("/audio.wav");
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "hello" })));
      mockProc.emit("close", 0);
      await promise;
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ audioPath: "/audio.wav", text: "hello" }));
    });

    it("should not pass language flag when language is auto", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const c = new WhisperClient({ language: "auto", modelPath: "/models/test.bin" });
      const promise = c.transcribe("/audio.wav");
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      await promise;
      expect(mockSpawn.mock.calls[0][1]).not.toContain("--language");
      await c.terminate();
    });
  });

  // ============================================================
  // Transcribe - API Mode
  // ============================================================

  describe("transcribe (API mode)", () => {
    let apiClient;
    beforeEach(() => {
      mockAxiosPost.mockReset();
      apiClient = new WhisperClient({ mode: "api", apiKey: "sk-test-key-12345", apiBaseURL: "https://api.openai.com/v1" });
    });
    afterEach(async () => { if (apiClient) { await apiClient.terminate(); apiClient = null; } });

    it("should transcribe audio via OpenAI API", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { text: "Hello from API", segments: [{ start: 0, end: 2.0, text: "Hello" }, { start: 2.0, end: 4.0, text: "from API" }], language: "en", duration: 4.0 },
      });
      const result = await apiClient.transcribe("/audio.wav", { language: "en", responseFormat: "verbose_json" });
      expect(result.text).toBe("Hello from API");
      expect(result.segments).toHaveLength(2);
      expect(result.language).toBe("en");
      expect(result.duration).toBe(4.0);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/transcriptions", expect.anything(),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-test-key-12345" }) }),
      );
    });

    it("should throw error when API key is missing", async () => {
      const c = new WhisperClient({ mode: "api", apiKey: "" });
      const origKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      await expect(c.transcribe("/audio.wav")).rejects.toThrow("API key is required");
      if (origKey) {process.env.OPENAI_API_KEY = origKey;}
      await c.terminate();
    });

    it("should handle API error responses", async () => {
      mockAxiosPost.mockRejectedValue({ response: { status: 401, statusText: "Unauthorized", data: { error: { message: "Invalid API key" } } } });
      await expect(apiClient.transcribe("/audio.wav")).rejects.toThrow("Whisper API error (401): Invalid API key");
      expect(apiClient.stats.errors).toBe(1);
    });

    it("should handle network errors", async () => {
      mockAxiosPost.mockRejectedValue(new Error("Network timeout"));
      await expect(apiClient.transcribe("/audio.wav")).rejects.toThrow("Whisper API request failed: Network timeout");
    });

    it("should handle non-verbose JSON response format", async () => {
      mockAxiosPost.mockResolvedValue({ data: { text: "Simple text response" } });
      const result = await apiClient.transcribe("/audio.wav", { responseFormat: "json" });
      expect(result.text).toBe("Simple text response");
    });

    it("should handle string response format (srt/vtt)", async () => {
      mockAxiosPost.mockResolvedValue({ data: "1\n00:00:00,000 --> 00:00:02,000\nHello\n" });
      const result = await apiClient.transcribe("/audio.wav", { responseFormat: "srt" });
      expect(result.text).toContain("Hello");
    });

    it("should update API mode statistics", async () => {
      mockAxiosPost.mockResolvedValue({ data: { text: "hello", duration: 1.5 } });
      await apiClient.transcribe("/audio.wav");
      expect(apiClient.stats.byMode.api).toBe(1);
      expect(apiClient.stats.totalTranscriptions).toBe(1);
    });
  });

  // ============================================================
  // _parseWhisperOutput Tests
  // ============================================================

  describe("_parseWhisperOutput", () => {
    it("should parse whisper.cpp transcription format", () => {
      const input = JSON.stringify({
        transcription: [
          { timestamps: { from: "00:00:00.000", to: "00:00:03.000" }, text: " First segment." },
          { timestamps: { from: "00:00:03.000", to: "00:00:06.500" }, text: " Second segment." },
        ],
      });
      const result = client._parseWhisperOutput(input);
      expect(result.text).toBe("First segment. Second segment.");
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].start).toBe(0);
      expect(result.segments[0].end).toBe(3);
      expect(result.segments[1].end).toBe(6.5);
      expect(result.duration).toBe(6.5);
    });

    it("should parse OpenAI-compatible JSON format", () => {
      const input = JSON.stringify({ text: "Hello world", segments: [{ start: 0, end: 2.5, text: "Hello world" }], language: "en", duration: 2.5 });
      const result = client._parseWhisperOutput(input);
      expect(result.text).toBe("Hello world");
      expect(result.language).toBe("en");
      expect(result.duration).toBe(2.5);
    });

    it("should handle offsets format (ms-based)", () => {
      const input = JSON.stringify({ transcription: [{ offsets: { from: 0, to: 3000 }, text: "Test" }] });
      expect(client._parseWhisperOutput(input).segments[0].end).toBe(3);
    });

    it("should throw on empty input", () => { expect(() => client._parseWhisperOutput("")).toThrow("Empty or invalid"); });
    it("should throw on null input", () => { expect(() => client._parseWhisperOutput(null)).toThrow("Empty or invalid"); });
    it("should throw on unrecognized format", () => { expect(() => client._parseWhisperOutput(JSON.stringify({ x: 1 }))).toThrow("Unrecognized"); });

    it("should handle empty transcription array", () => {
      const result = client._parseWhisperOutput(JSON.stringify({ transcription: [] }));
      expect(result.text).toBe("");
      expect(result.segments).toHaveLength(0);
    });

    it("should trim whitespace from segment text", () => {
      const input = JSON.stringify({ transcription: [{ timestamps: { from: "0:0:0.0", to: "0:0:1.0" }, text: "   trimmed   " }] });
      expect(client._parseWhisperOutput(input).segments[0].text).toBe("trimmed");
    });
  });

  // ============================================================
  // _parseTimestamp Tests
  // ============================================================

  describe("_parseTimestamp", () => {
    it("should parse HH:MM:SS.mmm format", () => { expect(client._parseTimestamp("00:01:30.500")).toBe(90.5); });
    it("should parse MM:SS.mmm format", () => { expect(client._parseTimestamp("01:30.500")).toBe(90.5); });
    it("should return number input as-is", () => { expect(client._parseTimestamp(42.5)).toBe(42.5); });
    it("should return 0 for unparseable input", () => { expect(client._parseTimestamp("invalid")).toBe(0); });
  });

  // ============================================================
  // listModels Tests
  // ============================================================

  describe("listModels", () => {
    it("should return all model sizes with download status", async () => {
      mockFs.accessSync.mockImplementation((p) => {
        if (String(p).includes("ggml-tiny.bin") || String(p).includes("ggml-base.bin")) {return;}
        throw new Error("ENOENT");
      });
      const models = await client.listModels();
      expect(models).toHaveLength(5);
      expect(models.find((m) => m.size === "tiny").downloaded).toBe(true);
      expect(models.find((m) => m.size === "base").downloaded).toBe(true);
      expect(models.find((m) => m.size === "small").downloaded).toBe(false);
    });

    it("should return correct paths for models", async () => {
      mockFs.accessSync.mockImplementation(() => { throw new Error("ENOENT"); });
      const models = await client.listModels();
      for (const m of models) { expect(m.path).toContain("whisper"); }
    });

    it("should handle all models being absent", async () => {
      mockFs.accessSync.mockImplementation(() => { throw new Error("ENOENT"); });
      expect((await client.listModels()).filter((m) => m.downloaded).length).toBe(0);
    });
  });

  // ============================================================
  // downloadModel Tests
  // ============================================================

  describe("downloadModel", () => {
    it("should throw error for invalid model size", async () => {
      await expect(client.downloadModel("nonexistent")).rejects.toThrow("Invalid model size");
    });

    it("should return existing model without re-downloading", async () => {
      const result = await client.downloadModel("base");
      expect(result.path).toContain("ggml-base.bin");
      expect(result.size).toBe(142000000);
    });

    it("should not emit download:start when model already exists", async () => {
      const handler = vi.fn();
      client.on("download:start", handler);
      await client.downloadModel("tiny");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // startStream Tests
  // ============================================================

  describe("startStream", () => {
    it("should start a streaming session and return stream ID", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const streamId = await client.startStream({ step: 2000 });
      expect(streamId).toBe("test-uuid-1234");
      expect(client.activeStreams.size).toBe(1);
    });

    it("should pass correct arguments for streaming", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const c = new WhisperClient({ language: "zh", modelPath: "/models/test.bin" });
      await c.startStream({ step: 5000 });
      expect(mockSpawn).toHaveBeenCalledWith("whisper-cpp-main", expect.arrayContaining(["--stream", "--step", "5000", "--language", "zh"]));
      await c.terminate();
    });

    it("should throw error in API mode", async () => {
      const c = new WhisperClient({ mode: "api", apiKey: "test" });
      await expect(c.startStream()).rejects.toThrow("only available in local mode");
      await c.terminate();
    });

    it("should emit transcript events from stream", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const handler = vi.fn();
      client.on("transcript", handler);
      await client.startStream();
      mockProc.stdout.emit("data", Buffer.from("Hello world\n"));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello world", partial: true }));
    });

    it("should emit stream:end when process closes", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const handler = vi.fn();
      client.on("stream:end", handler);
      await client.startStream();
      mockProc.emit("close", 0);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ code: 0 }));
    });

    it("should emit stream:error on spawn error", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const handler = vi.fn();
      client.on("stream:error", handler);
      await client.startStream();
      mockProc.emit("error", new Error("spawn failed"));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ error: "spawn failed" }));
    });

    it("should throw error when model file does not exist", async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      await expect(client.startStream()).rejects.toThrow("Whisper model not found");
    });
  });

  // ============================================================
  // stopStream Tests
  // ============================================================

  describe("stopStream", () => {
    it("should stop an active stream", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const streamId = await client.startStream();
      await client.stopStream(streamId);
      expect(mockProc.stdin.end).toHaveBeenCalled();
      expect(client.activeStreams.size).toBe(0);
    });

    it("should throw error for unknown stream ID", async () => {
      await expect(client.stopStream("nonexistent-id")).rejects.toThrow("Stream not found");
    });
  });

  // ============================================================
  // voiceChat Tests
  // ============================================================

  describe("voiceChat", () => {
    let mockLlmManager;
    let mockTtsManager;

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockLlmManager = { chatWithMessages: vi.fn().mockResolvedValue({ content: "I am an AI assistant. How can I help?" }) };
      mockTtsManager = { synthesize: vi.fn().mockResolvedValue({ audio: Buffer.from("fake"), format: "wav", provider: "edge", duration: 3.2 }) };
    });

    it("should complete full voice chat pipeline", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", mockLlmManager, mockTtsManager, { systemPrompt: "You are helpful." });
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "What is the weather today?" })));
      mockProc.emit("close", 0);
      const result = await promise;
      expect(result.userText).toBe("What is the weather today?");
      expect(result.assistantText).toBe("I am an AI assistant. How can I help?");
      expect(result.audioResponse).toBeDefined();
      expect(result.audioResponse.format).toBe("wav");
    });

    it("should emit voicechat events during pipeline", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const stepHandler = vi.fn();
      client.on("voicechat:step", stepHandler);
      const promise = client.voiceChat("/audio.wav", mockLlmManager, mockTtsManager);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      await promise;
      const steps = stepHandler.mock.calls.map((c) => c[0]);
      expect(steps.some((s) => s.step === "stt" && s.status === "started")).toBe(true);
      expect(steps.some((s) => s.step === "llm" && s.status === "complete")).toBe(true);
      expect(steps.some((s) => s.step === "tts" && s.status === "complete")).toBe(true);
    });

    it("should work without TTS manager", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", mockLlmManager, null);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      expect((await promise).audioResponse).toBeNull();
    });

    it("should handle TTS failure gracefully", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockTtsManager.synthesize.mockRejectedValue(new Error("TTS unavailable"));
      const promise = client.voiceChat("/audio.wav", mockLlmManager, mockTtsManager);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "hello" })));
      mockProc.emit("close", 0);
      const result = await promise;
      expect(result.userText).toBe("hello");
      expect(result.audioResponse).toBeNull();
    });

    it("should throw when STT fails", async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(client.voiceChat("/missing.wav", mockLlmManager, mockTtsManager)).rejects.toThrow("STT failed");
    });

    it("should throw when LLM manager is not provided", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", null, mockTtsManager);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      await expect(promise).rejects.toThrow("LLM failed");
    });

    it("should throw when LLM manager lacks chatWithMessages", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", { chat: vi.fn() }, mockTtsManager);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      await expect(promise).rejects.toThrow("must have a chatWithMessages method");
    });

    it("should handle empty transcription (no speech)", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", mockLlmManager, mockTtsManager);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "" })));
      mockProc.emit("close", 0);
      await expect(promise).rejects.toThrow("No speech detected");
    });

    it("should handle LLM returning string response", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockLlmManager.chatWithMessages.mockResolvedValue("Direct string response");
      const promise = client.voiceChat("/audio.wav", mockLlmManager, null);
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "test" })));
      mockProc.emit("close", 0);
      expect((await promise).assistantText).toBe("Direct string response");
    });

    it("should pass conversation options to LLM", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      const promise = client.voiceChat("/audio.wav", mockLlmManager, null, { systemPrompt: "Be concise.", conversationId: "conv-123" });
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify({ text: "user question" })));
      mockProc.emit("close", 0);
      await promise;
      const [messages, opts] = mockLlmManager.chatWithMessages.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "system", content: "Be concise." });
      expect(messages[1]).toEqual({ role: "user", content: "user question" });
      expect(opts.conversationId).toBe("conv-123");
    });
  });

  // ============================================================
  // getStats / _getModelPath / _getModelsDir
  // ============================================================

  describe("getStats", () => {
    it("should return current statistics", () => {
      const stats = client.getStats();
      expect(stats.totalTranscriptions).toBe(0);
      expect(stats.mode).toBe("local");
      expect(stats.activeStreams).toBe(0);
    });
  });

  describe("_getModelPath", () => {
    it("should return correct path for valid model size", () => { expect(client._getModelPath("tiny")).toContain("ggml-tiny.bin"); });
    it("should throw for invalid model size", () => { expect(() => client._getModelPath("nonexistent")).toThrow("Unknown model size"); });
  });

  describe("_getModelsDir", () => {
    it("should return a path containing models/whisper", () => { expect(client._getModelsDir()).toContain("whisper"); });
  });

  // ============================================================
  // terminate Tests
  // ============================================================

  describe("terminate", () => {
    it("should stop all active streams", async () => {
      const mockProc1 = createMockProcess();
      const mockProc2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);
      _deps.uuidv4.mockReturnValueOnce("stream-1").mockReturnValueOnce("stream-2");
      await client.startStream();
      await client.startStream();
      expect(client.activeStreams.size).toBe(2);
      await client.terminate();
      expect(client.activeStreams.size).toBe(0);
    });

    it("should handle terminate when no streams are active", async () => {
      await client.terminate();
      expect(client.activeStreams.size).toBe(0);
    });
  });
});
