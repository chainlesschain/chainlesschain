/**
 * Local TTS Client — downloadModel() tests
 *
 * Tests the model auto-download feature using _deps injection
 * to mock filesystem and HTTP operations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { LocalTTSClient, PIPER_MODELS, _deps } =
  await import("../local-tts-client.js");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock fs.promises object */
function createMockFs({ accessFails = true } = {}) {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: accessFails
      ? vi.fn().mockRejectedValue(new Error("ENOENT"))
      : vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("{}"),
    unlink: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
  };
}

/** Create a mock HTTPS module that simulates a successful download */
function createMockHttps({ statusCode = 200, redirectUrl = null } = {}) {
  return {
    get: vi.fn((url, callback) => {
      const response = new (require("events").EventEmitter)();
      response.statusCode = redirectUrl ? 302 : statusCode;
      response.headers = redirectUrl ? { location: redirectUrl } : {};
      response.resume = vi.fn();
      response.pipe = vi.fn((stream) => {
        // Simulate data written
        process.nextTick(() => stream.emit("finish"));
        return stream;
      });

      process.nextTick(() => callback(response));

      const request = new (require("events").EventEmitter)();
      return request;
    }),
  };
}

/** Create a mock fsSync (createWriteStream) */
function createMockFsSync() {
  const EventEmitter = require("events");
  return {
    createWriteStream: vi.fn(() => {
      const stream = new EventEmitter();
      stream.close = vi.fn();
      return stream;
    }),
    unlink: vi.fn((p, cb) => cb && cb()),
  };
}

// ─── Save & Restore _deps ─────────────────────────────────────────────────
let origFs;
beforeEach(() => {
  origFs = _deps.fs;
  _deps.https = null;
  _deps.http = null;
  _deps.fsSync = null;
});

// Restore after each test
import { afterEach } from "vitest";
afterEach(() => {
  _deps.fs = origFs;
  _deps.https = null;
  _deps.http = null;
  _deps.fsSync = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LocalTTSClient", () => {
  describe("PIPER_MODELS", () => {
    it("contains known models", () => {
      expect(PIPER_MODELS["en_US-lessac-medium"]).toBeTruthy();
      expect(PIPER_MODELS["zh_CN-huayan-medium"]).toBeTruthy();
    });

    it("all models have language and sampleRate", () => {
      for (const [, model] of Object.entries(PIPER_MODELS)) {
        expect(model.language).toBeTruthy();
        expect(model.sampleRate).toBeGreaterThan(0);
      }
    });
  });

  describe("downloadModel()", () => {
    let client;

    beforeEach(() => {
      client = new LocalTTSClient({ modelsDir: "/tmp/piper-models" });
    });

    it("throws if modelId is empty", async () => {
      await expect(client.downloadModel()).rejects.toThrow(
        "Model ID is required",
      );
    });

    it("throws for unknown model", async () => {
      await expect(client.downloadModel("nonexistent-model")).rejects.toThrow(
        "Unknown model",
      );
    });

    it("returns early if model already exists", async () => {
      const mockFs = createMockFs({ accessFails: false });
      _deps.fs = mockFs;

      const result = await client.downloadModel("en_US-lessac-medium");
      expect(result.alreadyExists).toBe(true);
      expect(result.modelId).toBe("en_US-lessac-medium");
    });

    it("downloads .onnx and .onnx.json files", async () => {
      // First two access calls fail (not downloaded), rest succeed
      let accessCallCount = 0;
      const mockFs = createMockFs();
      mockFs.access = vi.fn(() => {
        accessCallCount++;
        if (accessCallCount <= 2) {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve();
      });
      _deps.fs = mockFs;
      _deps.https = createMockHttps();
      _deps.fsSync = createMockFsSync();

      const result = await client.downloadModel("en_US-lessac-medium");
      expect(result.alreadyExists).toBe(false);
      expect(result.modelId).toBe("en_US-lessac-medium");
      expect(result.onnxPath).toContain("en_US-lessac-medium.onnx");
      expect(result.jsonPath).toContain("en_US-lessac-medium.onnx.json");

      // Two HTTPS get calls: one for .onnx, one for .onnx.json
      expect(_deps.https.get).toHaveBeenCalledTimes(2);
    });

    it("creates models directory if missing", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;
      _deps.https = createMockHttps();
      _deps.fsSync = createMockFsSync();

      client.config.modelsDir = null; // Force default
      await client.downloadModel("en_US-lessac-medium");
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });

    it("emits download-start and download-complete events", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;
      _deps.https = createMockHttps();
      _deps.fsSync = createMockFsSync();

      const startHandler = vi.fn();
      const completeHandler = vi.fn();
      client.on("download-start", startHandler);
      client.on("download-complete", completeHandler);

      await client.downloadModel("en_US-lessac-medium");
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "en_US-lessac-medium" }),
      );
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "en_US-lessac-medium" }),
      );
    });

    it("emits download-progress events", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;
      _deps.https = createMockHttps();
      _deps.fsSync = createMockFsSync();

      const progressHandler = vi.fn();
      client.on("download-progress", progressHandler);

      await client.downloadModel("en_US-lessac-medium");
      // At least 4 progress events: onnx start/end + json start/end
      expect(progressHandler).toHaveBeenCalledTimes(4);
    });

    it("registers model after download", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;
      _deps.https = createMockHttps();
      _deps.fsSync = createMockFsSync();

      await client.downloadModel("en_US-lessac-medium");
      const models = client.getModels();
      expect(models["en_US-lessac-medium"]).toBeTruthy();
      expect(models["en_US-lessac-medium"].language).toBe("en-US");
    });

    it("cleans up on download failure", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;

      // HTTPS that fails
      const failHttps = {
        get: vi.fn((url, callback) => {
          const request = new (require("events").EventEmitter)();
          process.nextTick(() =>
            request.emit("error", new Error("network error")),
          );
          return request;
        }),
      };
      _deps.https = failHttps;
      _deps.fsSync = createMockFsSync();

      await expect(client.downloadModel("en_US-lessac-medium")).rejects.toThrow(
        "Failed to download",
      );
      // Should attempt cleanup
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it("emits download-error on failure", async () => {
      const mockFs = createMockFs();
      _deps.fs = mockFs;

      const failHttps = {
        get: vi.fn((url, callback) => {
          const request = new (require("events").EventEmitter)();
          process.nextTick(() => request.emit("error", new Error("timeout")));
          return request;
        }),
      };
      _deps.https = failHttps;
      _deps.fsSync = createMockFsSync();

      const errorHandler = vi.fn();
      client.on("download-error", errorHandler);

      await expect(
        client.downloadModel("en_US-lessac-medium"),
      ).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "en_US-lessac-medium" }),
      );
    });
  });

  describe("_downloadFile()", () => {
    let client;

    beforeEach(() => {
      client = new LocalTTSClient();
    });

    it("rejects on HTTP error status", async () => {
      _deps.https = createMockHttps({ statusCode: 404 });
      _deps.fsSync = createMockFsSync();

      await expect(
        client._downloadFile("https://example.com/file", "/tmp/out"),
      ).rejects.toThrow("HTTP 404");
    });

    it("rejects on too many redirects", async () => {
      // Create https that always redirects
      _deps.https = {
        get: vi.fn((url, callback) => {
          const response = new (require("events").EventEmitter)();
          response.statusCode = 302;
          response.headers = { location: "https://example.com/redirect" };
          response.resume = vi.fn();
          process.nextTick(() => callback(response));
          return new (require("events").EventEmitter)();
        }),
      };
      _deps.fsSync = createMockFsSync();

      await expect(
        client._downloadFile("https://example.com/file", "/tmp/out"),
      ).rejects.toThrow("Too many redirects");
    });
  });
});
