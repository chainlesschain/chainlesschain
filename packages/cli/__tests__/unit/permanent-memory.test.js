import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CLIPermanentMemory, _deps } from "../../src/lib/permanent-memory.js";

describe("CLIPermanentMemory", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("creates instance without db", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.db).toBeNull();
      expect(pm._initialized).toBe(false);
    });

    it("creates instance with db", () => {
      const pm = new CLIPermanentMemory({ db: {}, memoryDir: "/tmp/test" });
      expect(pm.db).toEqual({});
      expect(pm.memoryDir).toBe("/tmp/test");
    });
  });

  // ── Initialize ──

  describe("initialize", () => {
    it("sets initialized flag", () => {
      const pm = new CLIPermanentMemory({});
      pm.initialize();
      expect(pm._initialized).toBe(true);
    });

    it("skips re-initialization", () => {
      const pm = new CLIPermanentMemory({});
      pm.initialize();
      pm.initialize(); // Should not throw
      expect(pm._initialized).toBe(true);
    });

    it("creates DB table when db is available", () => {
      const mockDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({ all: () => [] })),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      pm.initialize();
      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.exec.mock.calls[0][0]).toContain("permanent_memory");
    });

    it("handles DB table creation failure gracefully", () => {
      const mockDb = {
        exec: vi.fn(() => {
          throw new Error("DB error");
        }),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      // Should not throw
      pm.initialize();
      expect(pm._initialized).toBe(true);
    });

    it("creates directories when memoryDir is set", () => {
      const mockFs = {
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        readFileSync: vi.fn(() => ""),
      };
      _deps.fs = mockFs;
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/test-mem" });
      pm.initialize();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/tmp/test-mem", {
        recursive: true,
      });
    });
  });

  // ── appendDailyNote ──

  describe("appendDailyNote", () => {
    it("returns null when no memoryDir", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.appendDailyNote("test")).toBeNull();
    });

    it("creates new daily note file", () => {
      const written = {};
      _deps.fs = {
        existsSync: vi.fn((p) => p.includes("daily") && !p.endsWith(".md")),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          written[p] = c;
        }),
        readFileSync: vi.fn(() => ""),
        readdirSync: vi.fn(() => []),
        appendFileSync: vi.fn(),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.appendDailyNote("Test note content");

      expect(result).not.toBeNull();
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(_deps.fs.writeFileSync).toHaveBeenCalled();
    });

    it("appends to existing daily note", () => {
      _deps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(() => "existing content"),
        appendFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.appendDailyNote("New entry");

      expect(result).not.toBeNull();
      expect(_deps.fs.appendFileSync).toHaveBeenCalled();
    });
  });

  // ── updateMemoryFile ──

  describe("updateMemoryFile", () => {
    it("returns null when no memoryDir", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.updateMemoryFile("Test", "content")).toBeNull();
    });

    it("creates new MEMORY.md with section", () => {
      let writtenContent = "";
      _deps.fs = {
        existsSync: vi.fn((p) => !p.endsWith("MEMORY.md")),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          writtenContent = c;
        }),
        readFileSync: vi.fn(() => ""),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.updateMemoryFile("Patterns", "Use TypeScript");

      expect(result).not.toBeNull();
      expect(writtenContent).toContain("## Patterns");
      expect(writtenContent).toContain("Use TypeScript");
    });

    it("replaces existing section", () => {
      let writtenContent = "";
      _deps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          writtenContent = c;
        }),
        readFileSync: vi.fn(
          () =>
            "# Memory\n\n## Patterns\n\nOld content\n\n## Other\n\nKeep this",
        ),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      pm.updateMemoryFile("Patterns", "New content");

      expect(writtenContent).toContain("New content");
      expect(writtenContent).toContain("Keep this");
      expect(writtenContent).not.toContain("Old content");
    });
  });

  // ── hybridSearch ──

  describe("hybridSearch", () => {
    it("returns empty array when not initialized", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.hybridSearch("test")).toEqual([]);
    });

    it("returns empty for empty query", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.hybridSearch("")).toEqual([]);
    });
  });

  // ── getRelevantContext ──

  describe("getRelevantContext", () => {
    it("returns empty for null query", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.getRelevantContext(null)).toEqual([]);
    });

    it("initializes on first call", () => {
      const pm = new CLIPermanentMemory({});
      const spy = vi.spyOn(pm, "initialize");
      pm.getRelevantContext("test");
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── autoSummarize ──

  describe("autoSummarize", () => {
    it("returns empty for short sessions", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.autoSummarize([])).toEqual([]);
      expect(pm.autoSummarize([{ role: "user", content: "hi" }])).toEqual([]);
    });

    it("extracts tool usage patterns", () => {
      const pm = new CLIPermanentMemory({});
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "read config" },
        {
          role: "assistant",
          content: "reading",
          tool_calls: [{ function: { name: "read_file" } }],
        },
        { role: "tool", content: "file content", tool_call_id: "t1" },
        { role: "user", content: "now edit it" },
        {
          role: "assistant",
          content: "editing",
          tool_calls: [{ function: { name: "edit_file" } }],
        },
      ];

      const facts = pm.autoSummarize(messages);
      expect(facts.length).toBeGreaterThan(0);

      const toolsFact = facts.find((f) => f.includes("Tools used"));
      expect(toolsFact).toBeDefined();
      expect(toolsFact).toContain("read_file");
      expect(toolsFact).toContain("edit_file");
    });

    it("extracts user topics", () => {
      const pm = new CLIPermanentMemory({});
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "help me with authentication" },
        { role: "assistant", content: "sure" },
        { role: "user", content: "add JWT tokens" },
        { role: "assistant", content: "done" },
      ];

      const facts = pm.autoSummarize(messages);
      const topicFact = facts.find((f) => f.includes("Topics discussed"));
      expect(topicFact).toBeDefined();
      expect(topicFact).toContain("authentication");
    });
  });

  // ── _storeEntry ──

  describe("_storeEntry", () => {
    it("returns null without db", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm._storeEntry("test")).toBeNull();
    });

    it("stores entry in db", () => {
      const mockDb = {
        prepare: vi.fn(() => ({ run: vi.fn() })),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      const id = pm._storeEntry("test fact", "auto");
      expect(id).toBeTruthy();
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  // ── _buildIndex ──

  describe("_buildIndex", () => {
    it("builds index from memory file content", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent =
        "# Memory\n\n## Patterns\n\nUse TypeScript\n\n## Tools\n\nVim and VSCode";
      pm._dailyNotes = [];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).not.toBeNull();
    });

    it("builds index from daily notes", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent = "";
      pm._dailyNotes = [
        { date: "2026-03-12", content: "Worked on authentication feature" },
      ];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).not.toBeNull();
    });

    it("sets bm25 to null when no documents", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent = "";
      pm._dailyNotes = [];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).toBeNull();
    });
  });
});

// ── V2 Surface ──

import {
  PIN_MATURITY_V2,
  RETENTION_JOB_LIFECYCLE_V2,
  PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER,
  PERMMEM_DEFAULT_MAX_PENDING_JOBS_PER_PIN,
  PERMMEM_DEFAULT_PIN_IDLE_MS,
  PERMMEM_DEFAULT_JOB_STUCK_MS,
  getMaxActivePinsPerOwnerV2,
  setMaxActivePinsPerOwnerV2,
  getMaxPendingJobsPerPinV2,
  setMaxPendingJobsPerPinV2,
  getPinIdleMsV2,
  setPinIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerPinV2,
  getPinV2,
  listPinsV2,
  setPinStatusV2,
  activatePinV2,
  dormantPinV2,
  archivePinV2,
  touchPinV2,
  getActivePinCountV2,
  createRetentionJobV2,
  getRetentionJobV2,
  listRetentionJobsV2,
  setRetentionJobStatusV2,
  startRetentionJobV2,
  completeRetentionJobV2,
  failRetentionJobV2,
  cancelRetentionJobV2,
  getPendingJobCountV2,
  autoDormantIdlePinsV2,
  autoFailStuckJobsV2,
  getPermanentMemoryStatsV2,
  _resetStatePermanentMemoryV2,
} from "../../src/lib/permanent-memory.js";

describe("permanent-memory V2", () => {
  beforeEach(() => {
    _resetStatePermanentMemoryV2();
  });

  describe("enums", () => {
    it("PIN_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(PIN_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "dormant",
        "archived",
      ]);
      expect(Object.isFrozen(PIN_MATURITY_V2)).toBe(true);
    });

    it("RETENTION_JOB_LIFECYCLE_V2 frozen 5 states", () => {
      expect(Object.values(RETENTION_JOB_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]);
      expect(Object.isFrozen(RETENTION_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("defaults match constants", () => {
      expect(getMaxActivePinsPerOwnerV2()).toBe(
        PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER,
      );
      expect(getMaxPendingJobsPerPinV2()).toBe(
        PERMMEM_DEFAULT_MAX_PENDING_JOBS_PER_PIN,
      );
      expect(getPinIdleMsV2()).toBe(PERMMEM_DEFAULT_PIN_IDLE_MS);
      expect(getJobStuckMsV2()).toBe(PERMMEM_DEFAULT_JOB_STUCK_MS);
    });

    it("setters update", () => {
      setMaxActivePinsPerOwnerV2(33);
      expect(getMaxActivePinsPerOwnerV2()).toBe(33);
      setMaxPendingJobsPerPinV2(7);
      expect(getMaxPendingJobsPerPinV2()).toBe(7);
      setPinIdleMsV2(1234);
      expect(getPinIdleMsV2()).toBe(1234);
      setJobStuckMsV2(5678);
      expect(getJobStuckMsV2()).toBe(5678);
    });

    it("setters floor non-integers", () => {
      setMaxActivePinsPerOwnerV2(8.6);
      expect(getMaxActivePinsPerOwnerV2()).toBe(8);
    });

    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActivePinsPerOwnerV2(0)).toThrow();
      expect(() => setMaxPendingJobsPerPinV2(-1)).toThrow();
      expect(() => setPinIdleMsV2(NaN)).toThrow();
      expect(() => setJobStuckMsV2("nope")).toThrow();
    });

    it("_resetState restores defaults", () => {
      setMaxActivePinsPerOwnerV2(99);
      _resetStatePermanentMemoryV2();
      expect(getMaxActivePinsPerOwnerV2()).toBe(
        PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER,
      );
    });
  });

  describe("registerPinV2", () => {
    it("creates pending pin", () => {
      const p = registerPinV2("p1", {
        ownerId: "u1",
        label: "Project alpha",
        now: 1000,
      });
      expect(p.status).toBe("pending");
      expect(p.activatedAt).toBeNull();
      expect(p.archivedAt).toBeNull();
    });

    it("rejects invalid id/owner/label", () => {
      expect(() => registerPinV2("", { ownerId: "u", label: "L" })).toThrow();
      expect(() => registerPinV2("p", { ownerId: "", label: "L" })).toThrow();
      expect(() => registerPinV2("p", { ownerId: "u", label: "" })).toThrow();
    });

    it("rejects duplicate", () => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
      expect(() => registerPinV2("p1", { ownerId: "u", label: "L2" })).toThrow(
        /already exists/,
      );
    });

    it("returns defensive copy", () => {
      const p = registerPinV2("p1", {
        ownerId: "u",
        label: "L",
        metadata: { k: "v" },
      });
      p.metadata.k = "tampered";
      expect(getPinV2("p1").metadata.k).toBe("v");
    });
  });

  describe("pin transitions", () => {
    beforeEach(() => {
      registerPinV2("p1", { ownerId: "u1", label: "L", now: 1000 });
    });

    it("pending→active stamps activatedAt", () => {
      const p = activatePinV2("p1", { now: 2000 });
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBe(2000);
    });

    it("dormant→active recovery preserves activatedAt", () => {
      activatePinV2("p1", { now: 2000 });
      dormantPinV2("p1", { now: 3000 });
      const p = activatePinV2("p1", { now: 4000 });
      expect(p.activatedAt).toBe(2000);
    });

    it("→archived stamps archivedAt and is terminal", () => {
      const p = archivePinV2("p1", { now: 5000 });
      expect(p.archivedAt).toBe(5000);
      expect(() => activatePinV2("p1")).toThrow(/terminal/);
    });

    it("rejects unknown status", () => {
      expect(() => setPinStatusV2("p1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal pending→dormant", () => {
      expect(() => dormantPinV2("p1")).toThrow(/cannot transition/);
    });

    it("rejects missing", () => {
      expect(() => activatePinV2("nope")).toThrow(/not found/);
    });

    it("per-owner cap enforced on pending→active only", () => {
      setMaxActivePinsPerOwnerV2(2);
      registerPinV2("p2", { ownerId: "u1", label: "L" });
      registerPinV2("p3", { ownerId: "u1", label: "L" });
      activatePinV2("p1");
      activatePinV2("p2");
      expect(() => activatePinV2("p3")).toThrow(/active-pin cap/);
    });

    it("dormant→active recovery exempt from cap", () => {
      setMaxActivePinsPerOwnerV2(2);
      registerPinV2("p2", { ownerId: "u1", label: "L" });
      registerPinV2("p3", { ownerId: "u1", label: "L" });
      activatePinV2("p1");
      activatePinV2("p2");
      dormantPinV2("p1");
      activatePinV2("p3");
      const p1 = activatePinV2("p1");
      expect(p1.status).toBe("active");
    });

    it("per-owner cap is owner-scoped", () => {
      setMaxActivePinsPerOwnerV2(1);
      registerPinV2("p2", { ownerId: "u2", label: "L" });
      activatePinV2("p1");
      const p = activatePinV2("p2");
      expect(p.status).toBe("active");
    });
  });

  describe("touchPinV2", () => {
    it("updates lastSeenAt", () => {
      registerPinV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activatePinV2("p1", { now: 2000 });
      const p = touchPinV2("p1", { now: 9999 });
      expect(p.lastSeenAt).toBe(9999);
      expect(p.status).toBe("active");
    });

    it("throws on missing", () => {
      expect(() => touchPinV2("nope")).toThrow(/not found/);
    });
  });

  describe("listPinsV2 + getActivePinCountV2", () => {
    it("filters by ownerId/status", () => {
      registerPinV2("p1", { ownerId: "u1", label: "L" });
      registerPinV2("p2", { ownerId: "u1", label: "L" });
      registerPinV2("p3", { ownerId: "u2", label: "L" });
      activatePinV2("p1");
      expect(listPinsV2({ ownerId: "u1" })).toHaveLength(2);
      expect(listPinsV2({ status: "active" })).toHaveLength(1);
    });

    it("counts only active", () => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
      registerPinV2("p2", { ownerId: "u", label: "L" });
      activatePinV2("p1");
      expect(getActivePinCountV2("u")).toBe(1);
    });
  });

  describe("createRetentionJobV2", () => {
    beforeEach(() => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
    });

    it("creates queued job", () => {
      const j = createRetentionJobV2("j1", {
        pinId: "p1",
        kind: "review",
        now: 1000,
      });
      expect(j.status).toBe("queued");
      expect(j.kind).toBe("review");
      expect(j.startedAt).toBeNull();
      expect(j.settledAt).toBeNull();
    });

    it("rejects invalid id/pinId", () => {
      expect(() => createRetentionJobV2("", { pinId: "p1" })).toThrow();
      expect(() => createRetentionJobV2("j", { pinId: "" })).toThrow();
    });

    it("rejects duplicate", () => {
      createRetentionJobV2("j1", { pinId: "p1" });
      expect(() => createRetentionJobV2("j1", { pinId: "p1" })).toThrow(
        /already exists/,
      );
    });

    it("per-pin cap counts queued+running", () => {
      setMaxPendingJobsPerPinV2(2);
      createRetentionJobV2("j1", { pinId: "p1" });
      createRetentionJobV2("j2", { pinId: "p1" });
      expect(() => createRetentionJobV2("j3", { pinId: "p1" })).toThrow(
        /pending-job cap/,
      );
      startRetentionJobV2("j1");
      expect(() => createRetentionJobV2("j3", { pinId: "p1" })).toThrow(
        /pending-job cap/,
      );
    });

    it("per-pin cap excludes terminals", () => {
      setMaxPendingJobsPerPinV2(2);
      createRetentionJobV2("j1", { pinId: "p1" });
      createRetentionJobV2("j2", { pinId: "p1" });
      cancelRetentionJobV2("j1");
      const j3 = createRetentionJobV2("j3", { pinId: "p1" });
      expect(j3.status).toBe("queued");
    });
  });

  describe("retention job transitions", () => {
    beforeEach(() => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
      createRetentionJobV2("j1", { pinId: "p1", now: 1000 });
    });

    it("queued→running stamps startedAt", () => {
      const j = startRetentionJobV2("j1", { now: 2000 });
      expect(j.status).toBe("running");
      expect(j.startedAt).toBe(2000);
      expect(j.settledAt).toBeNull();
    });

    it("running→completed stamps settledAt", () => {
      startRetentionJobV2("j1", { now: 2000 });
      const j = completeRetentionJobV2("j1", { now: 3000 });
      expect(j.settledAt).toBe(3000);
      expect(() => failRetentionJobV2("j1")).toThrow(/terminal/);
    });

    it("running→failed stamps settledAt", () => {
      startRetentionJobV2("j1", { now: 2000 });
      const j = failRetentionJobV2("j1", { now: 3000 });
      expect(j.status).toBe("failed");
      expect(j.settledAt).toBe(3000);
    });

    it("queued→cancelled stamps settledAt", () => {
      const j = cancelRetentionJobV2("j1", { now: 2500 });
      expect(j.status).toBe("cancelled");
      expect(j.settledAt).toBe(2500);
    });

    it("queued cannot complete directly", () => {
      expect(() => completeRetentionJobV2("j1")).toThrow(/cannot transition/);
    });

    it("rejects unknown status", () => {
      expect(() => setRetentionJobStatusV2("j1", "bogus")).toThrow(/unknown/);
    });

    it("rejects missing", () => {
      expect(() => startRetentionJobV2("nope")).toThrow(/not found/);
    });
  });

  describe("listRetentionJobsV2 + getPendingJobCountV2", () => {
    beforeEach(() => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
      registerPinV2("p2", { ownerId: "u", label: "L" });
      createRetentionJobV2("j1", { pinId: "p1" });
      createRetentionJobV2("j2", { pinId: "p1" });
      createRetentionJobV2("j3", { pinId: "p2" });
      startRetentionJobV2("j1");
    });

    it("filters by pinId/status", () => {
      expect(listRetentionJobsV2({ pinId: "p1" })).toHaveLength(2);
      expect(listRetentionJobsV2({ status: "queued" })).toHaveLength(2);
    });

    it("getPendingJobCountV2 counts queued+running", () => {
      expect(getPendingJobCountV2("p1")).toBe(2);
      expect(getPendingJobCountV2("p2")).toBe(1);
      cancelRetentionJobV2("j2");
      expect(getPendingJobCountV2("p1")).toBe(1);
    });
  });

  describe("autoDormantIdlePinsV2", () => {
    it("flips active→dormant when idle", () => {
      registerPinV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activatePinV2("p1", { now: 1000 });
      setPinIdleMsV2(500);
      const flipped = autoDormantIdlePinsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("dormant");
    });

    it("skips non-active", () => {
      registerPinV2("p1", { ownerId: "u", label: "L", now: 1000 });
      setPinIdleMsV2(500);
      const flipped = autoDormantIdlePinsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("preserves under-threshold", () => {
      registerPinV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activatePinV2("p1", { now: 1000 });
      setPinIdleMsV2(5000);
      const flipped = autoDormantIdlePinsV2({ now: 2000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckJobsV2", () => {
    beforeEach(() => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
    });

    it("flips running→failed when stuck", () => {
      createRetentionJobV2("j1", { pinId: "p1", now: 1000 });
      startRetentionJobV2("j1", { now: 1000 });
      setJobStuckMsV2(500);
      const flipped = autoFailStuckJobsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBe(2000);
    });

    it("skips non-running (queued)", () => {
      createRetentionJobV2("j1", { pinId: "p1", now: 1000 });
      setJobStuckMsV2(500);
      const flipped = autoFailStuckJobsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("skips terminals", () => {
      createRetentionJobV2("j1", { pinId: "p1", now: 1000 });
      cancelRetentionJobV2("j1", { now: 1000 });
      setJobStuckMsV2(500);
      const flipped = autoFailStuckJobsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getPermanentMemoryStatsV2", () => {
    it("zero-init when empty", () => {
      const s = getPermanentMemoryStatsV2();
      expect(s.totalPinsV2).toBe(0);
      expect(s.totalJobsV2).toBe(0);
      expect(s.pinsByStatus).toEqual({
        pending: 0,
        active: 0,
        dormant: 0,
        archived: 0,
      });
      expect(s.jobsByStatus).toEqual({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("counts by status + config snapshot", () => {
      registerPinV2("p1", { ownerId: "u", label: "L" });
      activatePinV2("p1");
      createRetentionJobV2("j1", { pinId: "p1" });
      startRetentionJobV2("j1");
      setMaxActivePinsPerOwnerV2(77);
      const s = getPermanentMemoryStatsV2();
      expect(s.totalPinsV2).toBe(1);
      expect(s.pinsByStatus.active).toBe(1);
      expect(s.totalJobsV2).toBe(1);
      expect(s.jobsByStatus.running).toBe(1);
      expect(s.maxActivePinsPerOwner).toBe(77);
    });
  });
});
