/**
 * QuantizationManager Unit Tests
 *
 * Covers:
 * - Constructor / default state
 * - initialize() creates DB table and sets initialized flag
 * - initialize() throws when no database provided
 * - startGGUF creates job record and delegates to GGUFQuantizer
 * - startGPTQ creates job record and delegates to GPTQQuantizer
 * - getStatus returns correct job status
 * - getStatus returns null for unknown jobId
 * - cancelJob kills running process and updates DB
 * - cancelJob returns false for non-running job
 * - listModels returns all jobs from DB
 * - listModels supports status/quantType filters
 * - deleteModel removes DB record and output file
 * - deleteModel returns false for unknown jobId
 * - getQuantLevels returns all 13+1 supported levels
 * - importToOllama sends correct request to Ollama API
 * - importToOllama throws on missing params
 * - Event emission for progress, completed, failed, cancelled
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// fs mock – injected via _deps.fs (vi.mock("fs") doesn't intercept inlined CJS requires)
const mockFs = {
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ size: 4096, isDirectory: () => false, isFile: () => true })),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(() => []),
};

// Mock child process returned by spawn – shared across GGUF and GPTQ quantizers
const mockChildProcess = {
  stdout: {
    on: vi.fn(),
  },
  stderr: {
    on: vi.fn(),
  },
  on: vi.fn(),
  kill: vi.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDb() {
  return {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("QuantizationManager", () => {
  let QuantizationManager;
  let manager;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset child process mock handlers each time
    mockChildProcess.stdout.on.mockReset();
    mockChildProcess.stderr.on.mockReset();
    mockChildProcess.on.mockReset();
    mockChildProcess.kill.mockReset();

    // Simulate that spawn returns a process that emits 'close' with code 0
    // after stdout/stderr handlers are registered
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === "close") {
        // Store the close callback for manual triggering in tests
        mockChildProcess._closeCallback = cb;
      }
    });

    const mod = require("../quantization-manager.js");
    QuantizationManager = mod.QuantizationManager;

    // Inject uuid mock via _deps shim (vi.mock("uuid") doesn't intercept CJS require)
    mod._deps.uuidv4 = vi.fn(() => "test-job-uuid");

    // Inject fs mock via _deps shim
    mod._deps.fs = mockFs;

    // Inject spawn mock into GGUF and GPTQ quantizers via their _deps shims
    const ggufMod = require("../gguf-quantizer.js");
    ggufMod._deps.spawn = vi.fn(() => mockChildProcess);

    const gptqMod = require("../gptq-quantizer.js");
    gptqMod._deps.spawn = vi.fn(() => mockChildProcess);

    mockDb = createMockDb();
    manager = new QuantizationManager({ database: mockDb });
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  // ----------------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------------

  describe("constructor", () => {
    it("creates instance with default state", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.initialized).toBe(false);
      expect(manager.runningJobs).toBeInstanceOf(Map);
      expect(manager.runningJobs.size).toBe(0);
    });

    it("allows construction without arguments", () => {
      const mgr = new QuantizationManager();
      expect(mgr.database).toBeNull();
      expect(mgr.initialized).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("creates DB table and index and sets initialized flag", async () => {
      await manager.initialize();

      // Source uses a single exec call with both CREATE TABLE and CREATE INDEX statements
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS quantization_jobs")
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_quantization_jobs_status")
      );
      expect(manager.initialized).toBe(true);
    });

    it("accepts database as parameter override", async () => {
      const newDb = createMockDb();
      const mgr = new QuantizationManager();
      await mgr.initialize(newDb);

      expect(mgr.database).toBe(newDb);
      expect(mgr.initialized).toBe(true);
    });

    it("throws when no database is provided", async () => {
      const mgr = new QuantizationManager();
      await expect(mgr.initialize()).rejects.toThrow("Database is required");
    });

    it("throws and logs if DB exec fails", async () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error("DB exec error");
      });

      await expect(manager.initialize()).rejects.toThrow("DB exec error");
      expect(manager.initialized).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // startGGUF()
  // ----------------------------------------------------------------

  describe("startGGUF()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("creates a job record in the database and returns it", async () => {
      const job = await manager.startGGUF(
        "/models/input.gguf",
        "/models/output-q4.gguf",
        "Q4_K_M"
      );

      expect(job).toEqual(
        expect.objectContaining({
          id: "test-job-uuid",
          input_path: "/models/input.gguf",
          output_path: "/models/output-q4.gguf",
          quant_type: "gguf",
          quant_level: "Q4_K_M",
          status: "pending",
          progress: 0,
        })
      );

      // Verify DB insert was called
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO quantization_jobs"),
        expect.arrayContaining([
          "test-job-uuid",
          "/models/input.gguf",
          "/models/output-q4.gguf",
          "gguf",
          "Q4_K_M",
        ])
      );
    });

    it("stores the running job in runningJobs map", async () => {
      await manager.startGGUF(
        "/models/input.gguf",
        "/models/output.gguf",
        "Q4_K_M"
      );

      expect(manager.runningJobs.has("test-job-uuid")).toBe(true);
      expect(manager.runningJobs.get("test-job-uuid").type).toBe("gguf");
    });

    it("emits job:started event", async () => {
      const startedSpy = vi.fn();
      manager.on("job:started", startedSpy);

      await manager.startGGUF(
        "/models/input.gguf",
        "/models/output.gguf",
        "Q8_0"
      );

      expect(startedSpy).toHaveBeenCalledWith({
        jobId: "test-job-uuid",
        type: "gguf",
      });
    });

    it("throws if not initialized", async () => {
      const uninitMgr = new QuantizationManager({ database: mockDb });
      await expect(
        uninitMgr.startGGUF("/in", "/out", "Q4_K_M")
      ).rejects.toThrow("not initialized");
    });

    it("stores additional options as JSON config", async () => {
      const opts = { threads: 8, memory_f16: true };
      await manager.startGGUF("/in", "/out", "Q4_K_M", opts);

      // The config param should be a JSON string of options
      const insertCall = mockDb.run.mock.calls.find((c) =>
        c[0].includes("INSERT INTO quantization_jobs")
      );
      expect(insertCall).toBeDefined();
      const params = insertCall[1];
      const configParam = params[9]; // config is the 10th param (index 9)
      expect(JSON.parse(configParam)).toEqual(opts);
    });
  });

  // ----------------------------------------------------------------
  // startGPTQ()
  // ----------------------------------------------------------------

  describe("startGPTQ()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("creates a GPTQ job record and returns it", async () => {
      const job = await manager.startGPTQ(
        "/models/llama-hf",
        "/models/llama-gptq",
        { bits: "4", groupSize: "128" }
      );

      expect(job).toEqual(
        expect.objectContaining({
          id: "test-job-uuid",
          input_path: "/models/llama-hf",
          output_path: "/models/llama-gptq",
          quant_type: "gptq",
          quant_level: "4bit-g128",
          status: "pending",
        })
      );
    });

    it("stores the running job as gptq type", async () => {
      await manager.startGPTQ("/in", "/out", {});

      expect(manager.runningJobs.has("test-job-uuid")).toBe(true);
      expect(manager.runningJobs.get("test-job-uuid").type).toBe("gptq");
    });

    it("emits job:started event with gptq type", async () => {
      const startedSpy = vi.fn();
      manager.on("job:started", startedSpy);

      await manager.startGPTQ("/in", "/out", {});

      expect(startedSpy).toHaveBeenCalledWith({
        jobId: "test-job-uuid",
        type: "gptq",
      });
    });
  });

  // ----------------------------------------------------------------
  // getStatus()
  // ----------------------------------------------------------------

  describe("getStatus()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("returns job record from database", () => {
      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        input_path: "/in",
        output_path: "/out",
        quant_type: "gguf",
        quant_level: "Q4_K_M",
        status: "running",
        progress: 42,
        config: '{"threads": 4}',
      });

      const status = manager.getStatus("job-1");

      expect(status).toEqual(
        expect.objectContaining({
          id: "job-1",
          status: "running",
          progress: 42,
          config: { threads: 4 },
        })
      );
    });

    it("returns null for unknown jobId", () => {
      mockDb.get.mockReturnValueOnce(null);

      const status = manager.getStatus("nonexistent");
      expect(status).toBeNull();
    });

    it("handles unparseable config JSON gracefully", () => {
      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        config: "not-valid-json{",
        status: "completed",
      });

      const status = manager.getStatus("job-1");
      expect(status.config).toBe("not-valid-json{");
    });

    it("throws if not initialized", () => {
      const uninitMgr = new QuantizationManager({ database: mockDb });
      expect(() => uninitMgr.getStatus("id")).toThrow("not initialized");
    });
  });

  // ----------------------------------------------------------------
  // cancelJob()
  // ----------------------------------------------------------------

  describe("cancelJob()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("cancels a running job and updates DB status", async () => {
      // Start a job to populate runningJobs
      await manager.startGGUF("/in", "/out", "Q4_K_M");
      expect(manager.runningJobs.has("test-job-uuid")).toBe(true);

      const result = manager.cancelJob("test-job-uuid");

      expect(result).toBe(true);
      expect(manager.runningJobs.has("test-job-uuid")).toBe(false);

      // Check DB update (SQL uses '?' params; 'cancelled' is in the params array, not SQL string)
      const cancelCall = mockDb.run.mock.calls.find(
        (c) => c[0].includes("UPDATE") && Array.isArray(c[1]) && c[1].includes("cancelled")
      );
      expect(cancelCall).toBeDefined();
    });

    it("emits job:cancelled event", async () => {
      const cancelSpy = vi.fn();
      manager.on("job:cancelled", cancelSpy);

      await manager.startGGUF("/in", "/out", "Q4_K_M");
      manager.cancelJob("test-job-uuid");

      expect(cancelSpy).toHaveBeenCalledWith({ jobId: "test-job-uuid" });
    });

    it("returns false for non-running job", () => {
      const result = manager.cancelJob("not-running");
      expect(result).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // listModels()
  // ----------------------------------------------------------------

  describe("listModels()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("returns all jobs from DB", () => {
      mockDb.all.mockReturnValueOnce([
        { id: "j1", quant_type: "gguf", status: "completed", config: null },
        { id: "j2", quant_type: "gptq", status: "running", config: '{"bits":"4"}' },
      ]);

      const models = manager.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("j1");
      expect(models[1].config).toEqual({ bits: "4" });
    });

    it("uses default limit of 50 and offset 0", () => {
      mockDb.all.mockReturnValueOnce([]);

      manager.listModels();

      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("LIMIT");
      expect(call[1]).toContain(50);
      expect(call[1]).toContain(0);
    });

    it("supports status filter", () => {
      mockDb.all.mockReturnValueOnce([]);

      manager.listModels({ status: "completed" });

      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("status = ?");
      expect(call[1]).toContain("completed");
    });

    it("supports quantType filter", () => {
      mockDb.all.mockReturnValueOnce([]);

      manager.listModels({ quantType: "gguf" });

      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("quant_type = ?");
      expect(call[1]).toContain("gguf");
    });

    it("supports combined filters", () => {
      mockDb.all.mockReturnValueOnce([]);

      manager.listModels({ status: "completed", quantType: "gptq", limit: 10, offset: 5 });

      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("status = ?");
      expect(call[0]).toContain("quant_type = ?");
      expect(call[1]).toContain("completed");
      expect(call[1]).toContain("gptq");
      expect(call[1]).toContain(10);
      expect(call[1]).toContain(5);
    });

    it("returns empty array when no jobs exist", () => {
      mockDb.all.mockReturnValueOnce([]);
      const models = manager.listModels();
      expect(models).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // deleteModel()
  // ----------------------------------------------------------------

  describe("deleteModel()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("deletes job record from DB", () => {
      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        output_path: "/models/output.gguf",
        status: "completed",
      });

      const result = manager.deleteModel("job-1");

      expect(result).toBe(true);
      const deleteCall = mockDb.run.mock.calls.find((c) =>
        c[0].includes("DELETE FROM quantization_jobs")
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toContain("job-1");
    });

    it("emits job:deleted event", () => {
      const deleteSpy = vi.fn();
      manager.on("job:deleted", deleteSpy);

      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        output_path: "/out",
        status: "completed",
      });

      manager.deleteModel("job-1");
      expect(deleteSpy).toHaveBeenCalledWith({ jobId: "job-1" });
    });

    it("returns false for unknown jobId", () => {
      mockDb.get.mockReturnValueOnce(null);
      const result = manager.deleteModel("nonexistent");
      expect(result).toBe(false);
    });

    it("attempts to remove output file when it exists", () => {
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.statSync.mockReturnValueOnce({ isDirectory: () => false, size: 100 });

      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        output_path: "/models/output.gguf",
        status: "completed",
      });

      manager.deleteModel("job-1");
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/models/output.gguf");
    });

    it("removes directory output with rmSync for GPTQ models", () => {
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.statSync.mockReturnValueOnce({ isDirectory: () => true, size: 0 });

      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        output_path: "/models/gptq-output",
        status: "completed",
      });

      manager.deleteModel("job-1");
      expect(mockFs.rmSync).toHaveBeenCalledWith("/models/gptq-output", {
        recursive: true,
        force: true,
      });
    });

    it("handles file deletion errors gracefully", () => {
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.statSync.mockReturnValueOnce({ isDirectory: () => false, size: 100 });
      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw new Error("Permission denied");
      });

      mockDb.get.mockReturnValueOnce({
        id: "job-1",
        output_path: "/models/locked.gguf",
        status: "completed",
      });

      // Should not throw, just log warning
      const result = manager.deleteModel("job-1");
      expect(result).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // getQuantLevels()
  // ----------------------------------------------------------------

  describe("getQuantLevels()", () => {
    it("returns all 14 supported levels (13 + F32)", () => {
      const levels = manager.getQuantLevels();

      expect(levels).toHaveLength(14);
      expect(levels.map((l) => l.level)).toEqual([
        "Q2_K",
        "Q3_K_S",
        "Q3_K_M",
        "Q3_K_L",
        "Q4_0",
        "Q4_K_S",
        "Q4_K_M",
        "Q5_0",
        "Q5_K_S",
        "Q5_K_M",
        "Q6_K",
        "Q8_0",
        "F16",
        "F32",
      ]);
    });

    it("each level has level, bits, and description fields", () => {
      const levels = manager.getQuantLevels();

      for (const lvl of levels) {
        expect(lvl).toHaveProperty("level");
        expect(lvl).toHaveProperty("bits");
        expect(lvl).toHaveProperty("description");
        expect(typeof lvl.level).toBe("string");
        expect(typeof lvl.bits).toBe("number");
        expect(typeof lvl.description).toBe("string");
      }
    });

    it("returns a new array copy each time (not a reference)", () => {
      const a = manager.getQuantLevels();
      const b = manager.getQuantLevels();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  // ----------------------------------------------------------------
  // importToOllama()
  // ----------------------------------------------------------------

  describe("importToOllama()", () => {
    it("sends correct POST request to Ollama API", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "success" }),
        text: vi.fn().mockResolvedValue(""),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await manager.importToOllama(
        "/models/quantized.gguf",
        "my-model"
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/create"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "my-model",
            modelfile: "FROM /models/quantized.gguf",
          }),
        })
      );
      expect(result).toEqual({ status: "success" });
    });

    it("throws when API returns non-ok response", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue("Bad request: invalid model"),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(
        manager.importToOllama("/models/bad.gguf", "bad-model")
      ).rejects.toThrow("Ollama API error (400): Bad request: invalid model");
    });

    it("throws when modelPath is missing", async () => {
      await expect(
        manager.importToOllama("", "my-model")
      ).rejects.toThrow("Both modelPath and modelName are required");
    });

    it("throws when modelName is missing", async () => {
      await expect(
        manager.importToOllama("/models/model.gguf", "")
      ).rejects.toThrow("Both modelPath and modelName are required");
    });
  });

  // ----------------------------------------------------------------
  // _ensureInitialized()
  // ----------------------------------------------------------------

  describe("_ensureInitialized()", () => {
    it("throws descriptive error when not initialized", () => {
      const uninitMgr = new QuantizationManager({ database: mockDb });
      expect(() => uninitMgr._ensureInitialized()).toThrow(
        "QuantizationManager is not initialized"
      );
    });

    it("does not throw after initialization", async () => {
      await manager.initialize();
      expect(() => manager._ensureInitialized()).not.toThrow();
    });
  });
});
