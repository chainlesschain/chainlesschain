import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
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

const { AgentSandboxV2 } = require("../agent-sandbox-v2");

describe("AgentSandboxV2", () => {
  let sandbox;
  let db;

  beforeEach(() => {
    sandbox = new AgentSandboxV2();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start uninitialized", () => {
    expect(sandbox.initialized).toBe(false);
    expect(sandbox._sandboxes.size).toBe(0);
    expect(sandbox._auditLog).toHaveLength(0);
  });

  it("should initialize with database", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    expect(sandbox.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const callCount = db.exec.mock.calls.length;
    await sandbox.initialize(db, { autoPrune: false });
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Create Sandbox ---

  it("should create a sandbox with default permissions", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const result = sandbox.createSandbox("agent-1");
    expect(result.id).toMatch(/^sandbox-/);
    expect(result.status).toBe("created");
    expect(result.permissions).toBeDefined();
    expect(result.permissions.fileSystem.denied).toContain("system");
    expect(result.permissions.systemCalls.denied).toContain("exec");
    expect(result.quota).toBeDefined();
  });

  it("should create a sandbox with custom permissions", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const result = sandbox.createSandbox("agent-1", {
      permissions: {
        network: {
          allowedHosts: ["api.example.com"],
          deniedHosts: [],
          maxConnections: 5,
        },
      },
    });
    expect(result.permissions.network.allowedHosts).toContain(
      "api.example.com",
    );
  });

  it("should enforce max sandbox limit", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    sandbox._config.maxSandboxes = 2;
    sandbox.createSandbox("a1");
    sandbox.createSandbox("a2");
    expect(() => sandbox.createSandbox("a3")).toThrow(
      "Maximum sandbox limit reached",
    );
  });

  it("should emit sandbox:created event", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const handler = vi.fn();
    sandbox.on("sandbox:created", handler);
    sandbox.createSandbox("agent-1");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
    );
  });

  // --- Execute ---

  it("should execute code in sandbox successfully", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    const result = await sandbox.execute(id, "console.log('hello')");
    expect(result.exitCode).toBe(0);
    expect(result).toHaveProperty("duration");
    expect(result).toHaveProperty("resourceUsage");
  });

  it("should deny network access when not allowed", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    await expect(
      sandbox.execute(id, "fetch('http://evil.com')", {
        requiresNetwork: true,
      }),
    ).rejects.toThrow("Network access denied");
  });

  it("should allow network when hosts are configured", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1", {
      permissions: {
        network: {
          allowedHosts: ["api.safe.com"],
          deniedHosts: [],
          maxConnections: 5,
        },
      },
    });
    const result = await sandbox.execute(id, "fetch('http://api.safe.com')", {
      requiresNetwork: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("should throw when CPU quota exceeded", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    const sbx = sandbox._sandboxes.get(id);
    sbx.usage.cpu = sbx.quota.cpu; // max out CPU
    await expect(sandbox.execute(id, "heavy computation")).rejects.toThrow(
      "CPU quota exceeded",
    );
  });

  it("should throw for non-existent sandbox", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    await expect(sandbox.execute("no-sandbox", "code")).rejects.toThrow(
      "Sandbox not found",
    );
  });

  it("should throw for destroyed sandbox", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    sandbox.destroySandbox(id);
    await expect(sandbox.execute(id, "code")).rejects.toThrow(
      "Sandbox not found",
    );
  });

  it("should update resource usage after execution", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "some code");
    const sbx = sandbox._sandboxes.get(id);
    expect(sbx.usage.cpu).toBeGreaterThan(0);
  });

  // --- Permissions ---

  it("should update sandbox permissions", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    const updated = sandbox.setPermissions(id, {
      network: {
        allowedHosts: ["*.trusted.com"],
        deniedHosts: [],
        maxConnections: 20,
      },
    });
    expect(updated.network.allowedHosts).toContain("*.trusted.com");
  });

  it("should return null for unknown sandbox permissions", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    expect(sandbox.setPermissions("nope", {})).toBeNull();
  });

  // --- Audit Log ---

  it("should record audit entries during execution", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "console.log('test')");
    const log = sandbox.getAuditLog(id);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].sandboxId).toBe(id);
  });

  it("should filter audit log by sandbox id", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id: id1 } = sandbox.createSandbox("a1");
    const { id: id2 } = sandbox.createSandbox("a2");
    await sandbox.execute(id1, "code1");
    await sandbox.execute(id2, "code2");
    const log1 = sandbox.getAuditLog(id1);
    expect(log1.every((e) => e.sandboxId === id1)).toBe(true);
  });

  it("should filter audit log by action", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("a1");
    await sandbox.execute(id, "code");
    const log = sandbox.getAuditLog(id, { action: "execute" });
    expect(log.every((e) => e.action === "execute")).toBe(true);
  });

  // --- Quota ---

  it("should set custom quota", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    const quota = sandbox.setQuota(id, {
      cpu: 500,
      memory: 1024 * 1024 * 1024,
    });
    expect(quota.cpu).toBe(500);
    expect(quota.memory).toBe(1024 * 1024 * 1024);
  });

  it("should return null for unknown sandbox quota", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    expect(sandbox.setQuota("nope", { cpu: 1 })).toBeNull();
  });

  // --- Behavior Monitoring ---

  it("should detect no suspicious patterns for clean sandbox", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "clean code");
    const report = sandbox.monitorBehavior(id);
    expect(report.patterns).toHaveLength(0);
    expect(report.riskScore).toBe(0.1);
  });

  it("should detect excessive denied access pattern", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    // Inject denied audit entries
    for (let i = 0; i < 12; i++) {
      sandbox._auditLog.push({
        sandboxId: id,
        action: "access",
        resource: "file",
        result: "denied",
        timestamp: Date.now(),
      });
    }
    const report = sandbox.monitorBehavior(id);
    expect(
      report.patterns.some((p) => p.type === "excessive-denied-access"),
    ).toBe(true);
    expect(report.riskScore).toBe(0.7);
  });

  it("should return null for unknown sandbox monitoring", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    expect(sandbox.monitorBehavior("nope")).toBeNull();
  });

  // --- Destroy ---

  it("should destroy a sandbox", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const { id } = sandbox.createSandbox("agent-1");
    expect(sandbox.destroySandbox(id)).toBe(true);
    expect(sandbox._sandboxes.has(id)).toBe(false);
  });

  it("should return false when destroying unknown sandbox", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    expect(sandbox.destroySandbox("nope")).toBe(false);
  });

  it("should emit sandbox:destroyed event", async () => {
    await sandbox.initialize(db, { autoPrune: false });
    const handler = vi.fn();
    sandbox.on("sandbox:destroyed", handler);
    const { id } = sandbox.createSandbox("agent-1");
    sandbox.destroySandbox(id);
    expect(handler).toHaveBeenCalledWith({ sandboxId: id });
  });

  // --- Phase 4: Sandbox Policy lifecycle ---

  describe("Phase 4: bundle-aware lifecycle", () => {
    it("attaches a policy to created sandboxes", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1", {
        policy: { scope: "assistant" },
      });
      const inst = sandbox._sandboxes.get(id);
      expect(inst.policy.scope).toBe("assistant");
      expect(inst.policy.reuseAcrossRuns).toBe(true);
    });

    it("acquireSandbox creates a new thread sandbox by default", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const out = sandbox.acquireSandbox("agent-1");
      expect(out.reused).toBe(false);
      expect(out.scope).toBe("thread");
    });

    it("acquireSandbox reuses an assistant sandbox for the same agent", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const a = sandbox.acquireSandbox("agent-1", {
        policy: { scope: "assistant" },
      });
      const b = sandbox.acquireSandbox("agent-1", {
        policy: { scope: "assistant" },
      });
      expect(b.reused).toBe(true);
      expect(b.id).toBe(a.id);
    });

    it("acquireSandbox does not reuse across different agents", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const a = sandbox.acquireSandbox("agent-1", {
        policy: { scope: "assistant" },
      });
      const b = sandbox.acquireSandbox("agent-2", {
        policy: { scope: "assistant" },
      });
      expect(b.reused).toBe(false);
      expect(b.id).not.toBe(a.id);
    });

    it("touchSandbox refreshes lastUsedAt", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1");
      const inst = sandbox._sandboxes.get(id);
      inst.lastUsedAt = 0;
      expect(sandbox.touchSandbox(id)).toBe(true);
      expect(inst.lastUsedAt).toBeGreaterThan(0);
    });

    it("pruneExpired destroys ttl-expired sandboxes", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1", {
        policy: { scope: "thread", ttlMs: 10, idleTtlMs: null },
      });
      const inst = sandbox._sandboxes.get(id);
      inst.createdAt = Date.now() - 1000;
      const out = sandbox.pruneExpired();
      expect(out.find((x) => x.id === id)?.reason).toBe("ttl");
      expect(sandbox._sandboxes.has(id)).toBe(false);
    });

    it("pruneExpired destroys idle-expired sandboxes", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1", {
        policy: { scope: "assistant", ttlMs: null, idleTtlMs: 10 },
      });
      const inst = sandbox._sandboxes.get(id);
      inst.lastUsedAt = Date.now() - 1000;
      const out = sandbox.pruneExpired();
      expect(out.find((x) => x.id === id)?.reason).toBe("idle");
    });

    it("startPruneTimer triggers pruneExpired on interval", async () => {
      vi.useFakeTimers();
      try {
        await sandbox.initialize(db, { autoPrune: false });
        sandbox.startPruneTimer(1000);
        const { id } = sandbox.createSandbox("agent-1", {
          policy: { scope: "thread", ttlMs: 10, idleTtlMs: null },
        });
        sandbox._sandboxes.get(id).createdAt = Date.now() - 1000;
        vi.advanceTimersByTime(1000);
        expect(sandbox._sandboxes.has(id)).toBe(false);
        sandbox.stopPruneTimer();
        expect(sandbox._pruneTimer).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it("pruneExpired ignores sandboxes with null ttls", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1", {
        policy: { ttlMs: null, idleTtlMs: null },
      });
      expect(sandbox.pruneExpired()).toEqual([]);
      expect(sandbox._sandboxes.has(id)).toBe(true);
    });

    it("_persistSandbox writes policy + created_at_ms + last_used_at_ms", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      db._prep.run.mockClear();
      sandbox.createSandbox("agent-1", {
        policy: { scope: "assistant" },
      });
      // createSandbox calls _persistSandbox — the most recent run() payload
      // should contain the policy JSON + ms timestamps.
      const args = db._prep.run.mock.calls.at(-1);
      expect(args).toBeDefined();
      // columns: id, agent_id, status, permissions, quota, policy, created_at_ms, last_used_at_ms
      expect(typeof args[5]).toBe("string");
      expect(JSON.parse(args[5]).scope).toBe("assistant");
      expect(typeof args[6]).toBe("number");
      expect(typeof args[7]).toBe("number");
    });

    it("touchSandbox updates last_used_at_ms in db", async () => {
      await sandbox.initialize(db, { autoPrune: false });
      const { id } = sandbox.createSandbox("agent-1");
      db._prep.run.mockClear();
      sandbox.touchSandbox(id);
      const args = db._prep.run.mock.calls.at(-1);
      expect(args[0]).toBeTypeOf("number");
      expect(args[1]).toBe(id);
    });

    it("initialize auto-restores sandboxes from DB by default", async () => {
      const freshDb = createMockDB();
      freshDb._prep.all.mockReturnValue([
        {
          id: "auto-1",
          agent_id: "agent-auto",
          status: "idle",
          permissions: JSON.stringify({ fileSystem: {} }),
          quota: JSON.stringify({}),
          policy: JSON.stringify({ scope: "assistant" }),
          created_at_ms: 500,
          last_used_at_ms: 700,
        },
      ]);
      const fresh = new (require("../agent-sandbox-v2").AgentSandboxV2)();
      await fresh.initialize(freshDb, { autoPrune: false });
      expect(fresh._sandboxes.get("auto-1")).toBeDefined();
      expect(fresh._sandboxes.get("auto-1").policy.scope).toBe("assistant");
    });

    it("initialize skips auto-restore when autoRestore:false", async () => {
      const freshDb = createMockDB();
      freshDb._prep.all.mockReturnValue([
        {
          id: "skip-1",
          agent_id: "agent-skip",
          status: "idle",
          permissions: "{}",
          quota: "{}",
          policy: null,
          created_at_ms: 1,
          last_used_at_ms: 2,
        },
      ]);
      const fresh = new (require("../agent-sandbox-v2").AgentSandboxV2)();
      await fresh.initialize(freshDb, {
        autoPrune: false,
        autoRestore: false,
      });
      expect(fresh._sandboxes.size).toBe(0);
    });

    it("restoreFromDb rehydrates sandboxes from persisted rows", async () => {
      const freshDb = createMockDB();
      freshDb._prep.all.mockReturnValue([
        {
          id: "s-1",
          agent_id: "agent-1",
          status: "idle",
          permissions: JSON.stringify({ fileSystem: { denied: ["system"] } }),
          quota: JSON.stringify({ cpu: 100 }),
          policy: JSON.stringify({ scope: "assistant", ttlMs: 1000 }),
          created_at_ms: 1000,
          last_used_at_ms: 2000,
        },
      ]);
      const fresh = new (require("../agent-sandbox-v2").AgentSandboxV2)();
      await fresh.initialize(freshDb, { autoPrune: false });
      expect(fresh.restoreFromDb()).toBe(1);
      const inst = fresh._sandboxes.get("s-1");
      expect(inst).toBeDefined();
      expect(inst.policy.scope).toBe("assistant");
      expect(inst.createdAt).toBe(1000);
      expect(inst.lastUsedAt).toBe(2000);
    });
  });
});
