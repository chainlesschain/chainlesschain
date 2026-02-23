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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import * as child_process from "child_process";

// Mock dependencies
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-1234"),
}));

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock/userData"),
  },
}));

// Mock axios
vi.mock("axios", () => {
  const mockPost = vi.fn();
  return { default: { post: mockPost }, post: mockPost };
});

// Mock form-data
vi.mock("form-data", () => {
  const MockFormData = vi.fn().mockImplementation(() => ({
    append: vi.fn(),
    getHeaders: vi.fn(() => ({
      "content-type": "multipart/form-data; boundary=---test",
    })),
  }));
  return { default: MockFormData, __esModule: true };
});

// Use spyOn for fs and child_process (instead of module-level vi.mock)
const spyExistsSync = vi.spyOn(fs, "existsSync");
const spyAccessSync = vi.spyOn(fs, "accessSync");
const spyMkdirSync = vi.spyOn(fs, "mkdirSync");
const spyStatSync = vi.spyOn(fs, "statSync");
const spyCreateReadStream = vi.spyOn(fs, "createReadStream");
const spyUnlinkSync = vi.spyOn(fs, "unlinkSync");
const spyRenameSync = vi.spyOn(fs, "renameSync");
const spySpawn = vi.spyOn(child_process, "spawn");

const { WhisperClient } = require("../whisper-client");

/**
 * Helper: create a mock child process
 */
function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    end: vi.fn(),
    destroyed: false,
  };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    setTimeout(() => proc.emit("close", 0), 10);
  });
  return proc;
}

describe("WhisperClient", () => {
  let client;

  beforeEach(() => {
    // Reset all spies
    spyExistsSync.mockReset().mockReturnValue(true);
    spyAccessSync.mockReset().mockReturnValue(undefined);
    spyMkdirSync.mockReset().mockReturnValue(undefined);
    spyStatSync.mockReset().mockReturnValue({ size: 142000000 });
    spyCreateReadStream.mockReset().mockReturnValue({ pipe: vi.fn() });
    spyUnlinkSync.mockReset().mockReturnValue(undefined);
    spyRenameSync.mockReset().mockReturnValue(undefined);
    spySpawn.mockReset();

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
      const c = new WhisperClient();
      expect(c.activeStreams.size).toBe(0);
      c.removeAllListeners();
    });

    it("should initialize stats to zero", () => {
      const c = new WhisperClient();
      expect(c.stats).toEqual({
        totalTranscriptions: 0,
        totalDuration: 0,
        totalCharacters: 0,
        errors: 0,
        byMode: { local: 0, api: 0 },
      });
      c.removeAllListeners();
    });
  });

  // ============================================================
  // Transcribe Tests - Local Mode
  // ============================================================

  describe("transcribe (local mode)", () => {
    it("should transcribe audio using whisper.cpp", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const whisperOutput = JSON.stringify({
        transcription: [
          {
            timestamps: { from: "00:00:00.000", to: "00:00:02.500" },
            text: "Hello world",
          },
          {
            timestamps: { from: "00:00:02.500", to: "00:00:05.000" },
            text: "This is a test",
          },
        ],
      });

      const promise = client.transcribe("/path/to/audio.wav");

      mockProc.stdout.emit("data", Buffer.from(whisperOutput));
      mockProc.emit("close", 0);

      const result = await promise;

      expect(result.text).toBe("Hello world This is a test");
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].text).toBe("Hello world");
      expect(result.segments[0].start).toBe(0);
      expect(result.segments[0].end).toBe(2.5);
      expect(result.segments[1].text).toBe("This is a test");
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it("should pass correct arguments to whisper.cpp", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const c = new WhisperClient({
        mode: "local",
        language: "en",
        modelPath: "/models/test.bin",
        binaryPath: "/usr/bin/whisper",
      });

      const promise = c.transcribe("/audio.wav", {
        prompt: "test prompt",
        temperature: 0.5,
      });

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      await promise;

      expect(spySpawn).toHaveBeenCalledWith("/usr/bin/whisper", [
        "--model",
        "/models/test.bin",
        "--output-json",
        "-f",
        "/audio.wav",
        "--language",
        "en",
        "--prompt",
        "test prompt",
        "--temperature",
        "0.5",
      ]);

      await c.terminate();
    });

    it("should throw error when audio file does not exist", async () => {
      spyExistsSync.mockReturnValue(false);

      await expect(
        client.transcribe("/nonexistent/audio.wav"),
      ).rejects.toThrow("Audio file not found");
    });

    it("should throw error when whisper.cpp exits with non-zero code", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.transcribe("/path/to/audio.wav");

      mockProc.stderr.emit("data", Buffer.from("model file not found"));
      mockProc.emit("close", 1);

      await expect(promise).rejects.toThrow("model file not found");
      expect(client.stats.errors).toBe(1);
    });

    it("should throw error when whisper.cpp fails to spawn", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockImplementation(() => {
        process.nextTick(() => mockProc.emit("error", new Error("ENOENT")));
        return mockProc;
      });

      await expect(client.transcribe("/path/to/audio.wav")).rejects.toThrow(
        "Failed to start whisper.cpp",
      );
      expect(client.stats.errors).toBe(1);
    });

    it("should throw error when model file does not exist", async () => {
      spyExistsSync
        .mockReturnValueOnce(true) // audio file check
        .mockReturnValueOnce(false); // model file check

      await expect(client.transcribe("/audio.wav")).rejects.toThrow(
        "Whisper model not found",
      );
    });

    it("should fallback to plain text on parse error", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.transcribe("/audio.wav");

      mockProc.stdout.emit("data", Buffer.from("Just plain text output"));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.text).toBe("Just plain text output");
      expect(result.segments).toEqual([]);
    });

    it("should update statistics after successful transcription", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.transcribe("/audio.wav");

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "hello", duration: 2.5 })),
      );
      mockProc.emit("close", 0);

      await promise;

      expect(client.stats.totalTranscriptions).toBe(1);
      expect(client.stats.totalCharacters).toBe(5);
      expect(client.stats.totalDuration).toBe(2.5);
      expect(client.stats.byMode.local).toBe(1);
    });

    it("should emit transcription:complete event", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const handler = vi.fn();
      client.on("transcription:complete", handler);

      const promise = client.transcribe("/audio.wav");

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "hello" })),
      );
      mockProc.emit("close", 0);

      await promise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPath: "/audio.wav",
          text: "hello",
        }),
      );
    });

    it("should not pass language flag when language is auto", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const c = new WhisperClient({
        language: "auto",
        modelPath: "/models/test.bin",
      });

      const promise = c.transcribe("/audio.wav");

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      await promise;

      const args = spySpawn.mock.calls[0][1];
      expect(args).not.toContain("--language");

      await c.terminate();
    });
  });

  // ============================================================
  // Transcribe Tests - API Mode
  // ============================================================

  describe("transcribe (API mode)", () => {
    let apiClient;

    beforeEach(() => {
      apiClient = new WhisperClient({
        mode: "api",
        apiKey: "sk-test-key-12345",
        apiBaseURL: "https://api.openai.com/v1",
      });
    });

    afterEach(async () => {
      if (apiClient) {
        await apiClient.terminate();
        apiClient = null;
      }
    });

    it("should transcribe audio via OpenAI API", async () => {
      const axios = require("axios");
      axios.post.mockResolvedValue({
        data: {
          text: "Hello from API",
          segments: [
            { start: 0, end: 2.0, text: "Hello" },
            { start: 2.0, end: 4.0, text: "from API" },
          ],
          language: "en",
          duration: 4.0,
        },
      });

      const result = await apiClient.transcribe("/audio.wav", {
        language: "en",
        responseFormat: "verbose_json",
      });

      expect(result.text).toBe("Hello from API");
      expect(result.segments).toHaveLength(2);
      expect(result.language).toBe("en");
      expect(result.duration).toBe(4.0);

      expect(axios.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/transcriptions",
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-test-key-12345",
          }),
        }),
      );
    });

    it("should throw error when API key is missing", async () => {
      const noKeyClient = new WhisperClient({
        mode: "api",
        apiKey: "",
      });

      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await expect(noKeyClient.transcribe("/audio.wav")).rejects.toThrow(
        "API key is required",
      );

      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }

      await noKeyClient.terminate();
    });

    it("should handle API error responses", async () => {
      const axios = require("axios");
      axios.post.mockRejectedValue({
        response: {
          status: 401,
          statusText: "Unauthorized",
          data: {
            error: { message: "Invalid API key" },
          },
        },
      });

      await expect(apiClient.transcribe("/audio.wav")).rejects.toThrow(
        "Whisper API error (401): Invalid API key",
      );
      expect(apiClient.stats.errors).toBe(1);
    });

    it("should handle network errors", async () => {
      const axios = require("axios");
      axios.post.mockRejectedValue(new Error("Network timeout"));

      await expect(apiClient.transcribe("/audio.wav")).rejects.toThrow(
        "Whisper API request failed: Network timeout",
      );
    });

    it("should handle non-verbose JSON response format", async () => {
      const axios = require("axios");
      axios.post.mockResolvedValue({
        data: { text: "Simple text response" },
      });

      const result = await apiClient.transcribe("/audio.wav", {
        responseFormat: "json",
      });

      expect(result.text).toBe("Simple text response");
    });

    it("should handle string response format (srt/vtt)", async () => {
      const axios = require("axios");
      axios.post.mockResolvedValue({
        data: "1\n00:00:00,000 --> 00:00:02,000\nHello\n",
      });

      const result = await apiClient.transcribe("/audio.wav", {
        responseFormat: "srt",
      });

      expect(result.text).toContain("Hello");
    });

    it("should update API mode statistics", async () => {
      const axios = require("axios");
      axios.post.mockResolvedValue({
        data: { text: "hello", duration: 1.5 },
      });

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
          {
            timestamps: { from: "00:00:00.000", to: "00:00:03.000" },
            text: " First segment.",
          },
          {
            timestamps: { from: "00:00:03.000", to: "00:00:06.500" },
            text: " Second segment.",
          },
        ],
      });

      const result = client._parseWhisperOutput(input);

      expect(result.text).toBe("First segment. Second segment.");
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].start).toBe(0);
      expect(result.segments[0].end).toBe(3);
      expect(result.segments[0].text).toBe("First segment.");
      expect(result.segments[1].start).toBe(3);
      expect(result.segments[1].end).toBe(6.5);
      expect(result.duration).toBe(6.5);
    });

    it("should parse OpenAI-compatible JSON format", () => {
      const input = JSON.stringify({
        text: "Hello world",
        segments: [{ start: 0, end: 2.5, text: "Hello world" }],
        language: "en",
        duration: 2.5,
      });

      const result = client._parseWhisperOutput(input);

      expect(result.text).toBe("Hello world");
      expect(result.segments).toHaveLength(1);
      expect(result.language).toBe("en");
      expect(result.duration).toBe(2.5);
    });

    it("should handle offsets format (ms-based)", () => {
      const input = JSON.stringify({
        transcription: [
          { offsets: { from: 0, to: 3000 }, text: "Test with offsets" },
        ],
      });

      const result = client._parseWhisperOutput(input);

      expect(result.text).toBe("Test with offsets");
      expect(result.segments[0].start).toBe(0);
      expect(result.segments[0].end).toBe(3);
    });

    it("should throw on empty input", () => {
      expect(() => client._parseWhisperOutput("")).toThrow(
        "Empty or invalid whisper output",
      );
    });

    it("should throw on null input", () => {
      expect(() => client._parseWhisperOutput(null)).toThrow(
        "Empty or invalid whisper output",
      );
    });

    it("should throw on unrecognized format", () => {
      const input = JSON.stringify({ unknown: "data" });
      expect(() => client._parseWhisperOutput(input)).toThrow(
        "Unrecognized whisper output format",
      );
    });

    it("should handle empty transcription array", () => {
      const input = JSON.stringify({ transcription: [] });
      const result = client._parseWhisperOutput(input);
      expect(result.text).toBe("");
      expect(result.segments).toHaveLength(0);
      expect(result.duration).toBe(0);
    });

    it("should handle text with surrounding whitespace", () => {
      const input = JSON.stringify({
        transcription: [
          {
            timestamps: { from: "00:00:00.000", to: "00:00:01.000" },
            text: "   trimmed text   ",
          },
        ],
      });

      const result = client._parseWhisperOutput(input);
      expect(result.segments[0].text).toBe("trimmed text");
    });
  });

  // ============================================================
  // _parseTimestamp Tests
  // ============================================================

  describe("_parseTimestamp", () => {
    it("should parse HH:MM:SS.mmm format", () => {
      expect(client._parseTimestamp("00:01:30.500")).toBe(90.5);
    });

    it("should parse MM:SS.mmm format", () => {
      expect(client._parseTimestamp("01:30.500")).toBe(90.5);
    });

    it("should return number input as-is", () => {
      expect(client._parseTimestamp(42.5)).toBe(42.5);
    });

    it("should return 0 for unparseable input", () => {
      expect(client._parseTimestamp("invalid")).toBe(0);
    });
  });

  // ============================================================
  // listModels Tests
  // ============================================================

  describe("listModels", () => {
    it("should return all model sizes with download status", async () => {
      spyAccessSync.mockImplementation((filePath) => {
        if (
          String(filePath).includes("ggml-tiny.bin") ||
          String(filePath).includes("ggml-base.bin")
        ) {
          return;
        }
        throw new Error("ENOENT");
      });

      const models = await client.listModels();

      expect(models).toHaveLength(5);

      const tiny = models.find((m) => m.size === "tiny");
      expect(tiny).toBeDefined();
      expect(tiny.downloaded).toBe(true);
      expect(tiny.name).toBe("ggml-tiny.bin");
      expect(tiny.sizeBytes).toBeGreaterThan(0);

      const base = models.find((m) => m.size === "base");
      expect(base.downloaded).toBe(true);

      const small = models.find((m) => m.size === "small");
      expect(small.downloaded).toBe(false);

      const medium = models.find((m) => m.size === "medium");
      expect(medium.downloaded).toBe(false);

      const large = models.find((m) => m.size === "large");
      expect(large.downloaded).toBe(false);
    });

    it("should return correct paths for models", async () => {
      spyAccessSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const models = await client.listModels();

      for (const model of models) {
        expect(model.path).toContain("models");
        expect(model.path).toContain("whisper");
        expect(model.path).toContain(model.name);
      }
    });

    it("should handle all models being absent", async () => {
      spyAccessSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const models = await client.listModels();
      const downloadedCount = models.filter((m) => m.downloaded).length;
      expect(downloadedCount).toBe(0);
    });
  });

  // ============================================================
  // downloadModel Tests
  // ============================================================

  describe("downloadModel", () => {
    it("should throw error for invalid model size", async () => {
      await expect(client.downloadModel("nonexistent")).rejects.toThrow(
        "Invalid model size: nonexistent",
      );
    });

    it("should return existing model without re-downloading", async () => {
      spyExistsSync.mockReturnValue(true);
      spyStatSync.mockReturnValue({ size: 142000000 });

      const result = await client.downloadModel("base");

      expect(result.path).toContain("ggml-base.bin");
      expect(result.size).toBe(142000000);
    });

    it("should not emit download:start when model already exists", async () => {
      spyExistsSync.mockReturnValue(true);
      spyStatSync.mockReturnValue({ size: 75000000 });

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
      spySpawn.mockReturnValue(mockProc);

      const streamId = await client.startStream({ step: 2000 });

      expect(streamId).toBe("test-uuid-1234");
      expect(client.activeStreams.size).toBe(1);

      const streamInfo = client.activeStreams.get(streamId);
      expect(streamInfo.process).toBe(mockProc);
      expect(streamInfo.startedAt).toBeGreaterThan(0);
    });

    it("should pass correct arguments for streaming", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const c = new WhisperClient({
        language: "zh",
        modelPath: "/models/test.bin",
      });

      await c.startStream({ step: 5000 });

      expect(spySpawn).toHaveBeenCalledWith(
        "whisper-cpp-main",
        expect.arrayContaining([
          "--model",
          "/models/test.bin",
          "--stream",
          "--step",
          "5000",
          "--language",
          "zh",
        ]),
      );

      await c.terminate();
    });

    it("should throw error in API mode", async () => {
      const apiClient = new WhisperClient({ mode: "api", apiKey: "test" });

      await expect(apiClient.startStream()).rejects.toThrow(
        "only available in local mode",
      );

      await apiClient.terminate();
    });

    it("should emit transcript events from stream", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const handler = vi.fn();
      client.on("transcript", handler);

      await client.startStream();

      mockProc.stdout.emit("data", Buffer.from("Hello world\n"));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: "test-uuid-1234",
          text: "Hello world",
          partial: true,
        }),
      );
    });

    it("should emit stream:end when process closes", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const handler = vi.fn();
      client.on("stream:end", handler);

      await client.startStream();

      mockProc.emit("close", 0);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: "test-uuid-1234",
          code: 0,
        }),
      );
    });

    it("should emit stream:error on spawn error", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const handler = vi.fn();
      client.on("stream:error", handler);

      await client.startStream();

      mockProc.emit("error", new Error("spawn failed"));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: "test-uuid-1234",
          error: "spawn failed",
        }),
      );
    });

    it("should throw error when model file does not exist for streaming", async () => {
      spyExistsSync.mockReturnValueOnce(false);

      await expect(client.startStream()).rejects.toThrow(
        "Whisper model not found",
      );
    });
  });

  // ============================================================
  // stopStream Tests
  // ============================================================

  describe("stopStream", () => {
    it("should stop an active stream", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const streamId = await client.startStream();

      expect(client.activeStreams.size).toBe(1);

      await client.stopStream(streamId);

      expect(mockProc.stdin.end).toHaveBeenCalled();
      expect(client.activeStreams.size).toBe(0);
    });

    it("should throw error for unknown stream ID", async () => {
      await expect(client.stopStream("nonexistent-id")).rejects.toThrow(
        "Stream not found: nonexistent-id",
      );
    });
  });

  // ============================================================
  // voiceChat Tests
  // ============================================================

  describe("voiceChat", () => {
    let mockLlmManager;
    let mockTtsManager;

    beforeEach(() => {
      spyExistsSync.mockReturnValue(true);

      mockLlmManager = {
        chatWithMessages: vi.fn().mockResolvedValue({
          content: "I am an AI assistant. How can I help?",
        }),
      };

      mockTtsManager = {
        synthesize: vi.fn().mockResolvedValue({
          audio: Buffer.from("fake-audio"),
          format: "wav",
          provider: "edge",
          duration: 3.2,
        }),
      };
    });

    it("should complete full voice chat pipeline", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        mockTtsManager,
        { systemPrompt: "You are helpful." },
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({ text: "What is the weather today?" }),
        ),
      );
      mockProc.emit("close", 0);

      const result = await promise;

      expect(result.userText).toBe("What is the weather today?");
      expect(result.assistantText).toBe(
        "I am an AI assistant. How can I help?",
      );
      expect(result.audioResponse).toBeDefined();
      expect(result.audioResponse.format).toBe("wav");
      expect(result.chatId).toBe("test-uuid-1234");
    });

    it("should emit voicechat events during pipeline", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const startHandler = vi.fn();
      const stepHandler = vi.fn();
      const completeHandler = vi.fn();

      client.on("voicechat:start", startHandler);
      client.on("voicechat:step", stepHandler);
      client.on("voicechat:complete", completeHandler);

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        mockTtsManager,
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test input" })),
      );
      mockProc.emit("close", 0);

      await promise;

      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(completeHandler).toHaveBeenCalledTimes(1);

      const stepCalls = stepHandler.mock.calls.map((c) => c[0]);
      expect(
        stepCalls.some((s) => s.step === "stt" && s.status === "started"),
      ).toBe(true);
      expect(
        stepCalls.some((s) => s.step === "stt" && s.status === "complete"),
      ).toBe(true);
      expect(
        stepCalls.some((s) => s.step === "llm" && s.status === "started"),
      ).toBe(true);
      expect(
        stepCalls.some((s) => s.step === "llm" && s.status === "complete"),
      ).toBe(true);
      expect(
        stepCalls.some((s) => s.step === "tts" && s.status === "started"),
      ).toBe(true);
      expect(
        stepCalls.some((s) => s.step === "tts" && s.status === "complete"),
      ).toBe(true);
    });

    it("should work without TTS manager (text-only response)", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        null,
        {},
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      const result = await promise;

      expect(result.userText).toBe("test");
      expect(result.assistantText).toBe(
        "I am an AI assistant. How can I help?",
      );
      expect(result.audioResponse).toBeNull();
    });

    it("should handle TTS failure gracefully (non-fatal)", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      mockTtsManager.synthesize.mockRejectedValue(
        new Error("TTS service unavailable"),
      );

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        mockTtsManager,
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "hello" })),
      );
      mockProc.emit("close", 0);

      const result = await promise;

      expect(result.userText).toBe("hello");
      expect(result.assistantText).toBeDefined();
      expect(result.audioResponse).toBeNull();
    });

    it("should throw when STT fails", async () => {
      spyExistsSync.mockReturnValue(false);

      await expect(
        client.voiceChat("/missing.wav", mockLlmManager, mockTtsManager),
      ).rejects.toThrow("STT failed");
    });

    it("should throw when LLM manager is not provided", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.voiceChat("/audio.wav", null, mockTtsManager);

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      await expect(promise).rejects.toThrow("LLM failed");
    });

    it("should throw when LLM manager lacks chatWithMessages method", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const badLlmManager = { chat: vi.fn() };

      const promise = client.voiceChat(
        "/audio.wav",
        badLlmManager,
        mockTtsManager,
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      await expect(promise).rejects.toThrow(
        "LLM manager is required and must have a chatWithMessages method",
      );
    });

    it("should handle empty transcription (no speech detected)", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        mockTtsManager,
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "" })),
      );
      mockProc.emit("close", 0);

      await expect(promise).rejects.toThrow("No speech detected");
    });

    it("should handle LLM returning string response", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      mockLlmManager.chatWithMessages.mockResolvedValue(
        "Direct string response",
      );

      const promise = client.voiceChat("/audio.wav", mockLlmManager, null);

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "test" })),
      );
      mockProc.emit("close", 0);

      const result = await promise;

      expect(result.assistantText).toBe("Direct string response");
    });

    it("should pass conversation options to LLM", async () => {
      const mockProc = createMockProcess();
      spySpawn.mockReturnValue(mockProc);

      const promise = client.voiceChat(
        "/audio.wav",
        mockLlmManager,
        null,
        {
          systemPrompt: "Be concise.",
          conversationId: "conv-123",
        },
      );

      mockProc.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ text: "user question" })),
      );
      mockProc.emit("close", 0);

      await promise;

      const callArgs = mockLlmManager.chatWithMessages.mock.calls[0];
      const messages = callArgs[0];
      const options = callArgs[1];

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "system",
        content: "Be concise.",
      });
      expect(messages[1]).toEqual({
        role: "user",
        content: "user question",
      });
      expect(options.conversationId).toBe("conv-123");
    });
  });

  // ============================================================
  // getStats Tests
  // ============================================================

  describe("getStats", () => {
    it("should return current statistics", () => {
      const stats = client.getStats();

      expect(stats.totalTranscriptions).toBe(0);
      expect(stats.mode).toBe("local");
      expect(stats.modelSize).toBe("base");
      expect(stats.activeStreams).toBe(0);
    });
  });

  // ============================================================
  // _getModelPath Tests
  // ============================================================

  describe("_getModelPath", () => {
    it("should return correct path for valid model size", () => {
      const modelPath = client._getModelPath("tiny");

      expect(modelPath).toContain("ggml-tiny.bin");
      expect(modelPath).toContain("whisper");
    });

    it("should throw error for invalid model size", () => {
      expect(() => client._getModelPath("nonexistent")).toThrow(
        "Unknown model size: nonexistent",
      );
    });
  });

  // ============================================================
  // _getModelsDir Tests
  // ============================================================

  describe("_getModelsDir", () => {
    it("should return a path containing models/whisper", () => {
      const dir = client._getModelsDir();
      expect(dir).toContain("models");
      expect(dir).toContain("whisper");
    });
  });

  // ============================================================
  // terminate Tests
  // ============================================================

  describe("terminate", () => {
    it("should stop all active streams", async () => {
      const mockProc1 = createMockProcess();
      const mockProc2 = createMockProcess();

      spySpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);

      const uuid = await import("uuid");
      vi.mocked(uuid.v4)
        .mockReturnValueOnce("stream-1")
        .mockReturnValueOnce("stream-2");

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
