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
    await sandbox.initialize(db);
    expect(sandbox.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await sandbox.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await sandbox.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Create Sandbox ---

  it("should create a sandbox with default permissions", async () => {
    await sandbox.initialize(db);
    const result = sandbox.createSandbox("agent-1");
    expect(result.id).toMatch(/^sandbox-/);
    expect(result.status).toBe("created");
    expect(result.permissions).toBeDefined();
    expect(result.permissions.fileSystem.denied).toContain("system");
    expect(result.permissions.systemCalls.denied).toContain("exec");
    expect(result.quota).toBeDefined();
  });

  it("should create a sandbox with custom permissions", async () => {
    await sandbox.initialize(db);
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
    await sandbox.initialize(db);
    sandbox._config.maxSandboxes = 2;
    sandbox.createSandbox("a1");
    sandbox.createSandbox("a2");
    expect(() => sandbox.createSandbox("a3")).toThrow(
      "Maximum sandbox limit reached",
    );
  });

  it("should emit sandbox:created event", async () => {
    await sandbox.initialize(db);
    const handler = vi.fn();
    sandbox.on("sandbox:created", handler);
    sandbox.createSandbox("agent-1");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
    );
  });

  // --- Execute ---

  it("should execute code in sandbox successfully", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    const result = await sandbox.execute(id, "console.log('hello')");
    expect(result.exitCode).toBe(0);
    expect(result).toHaveProperty("duration");
    expect(result).toHaveProperty("resourceUsage");
  });

  it("should deny network access when not allowed", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    await expect(
      sandbox.execute(id, "fetch('http://evil.com')", {
        requiresNetwork: true,
      }),
    ).rejects.toThrow("Network access denied");
  });

  it("should allow network when hosts are configured", async () => {
    await sandbox.initialize(db);
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
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    const sbx = sandbox._sandboxes.get(id);
    sbx.usage.cpu = sbx.quota.cpu; // max out CPU
    await expect(sandbox.execute(id, "heavy computation")).rejects.toThrow(
      "CPU quota exceeded",
    );
  });

  it("should throw for non-existent sandbox", async () => {
    await sandbox.initialize(db);
    await expect(sandbox.execute("no-sandbox", "code")).rejects.toThrow(
      "Sandbox not found",
    );
  });

  it("should throw for destroyed sandbox", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    sandbox.destroySandbox(id);
    await expect(sandbox.execute(id, "code")).rejects.toThrow(
      "Sandbox not found",
    );
  });

  it("should update resource usage after execution", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "some code");
    const sbx = sandbox._sandboxes.get(id);
    expect(sbx.usage.cpu).toBeGreaterThan(0);
  });

  // --- Permissions ---

  it("should update sandbox permissions", async () => {
    await sandbox.initialize(db);
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
    await sandbox.initialize(db);
    expect(sandbox.setPermissions("nope", {})).toBeNull();
  });

  // --- Audit Log ---

  it("should record audit entries during execution", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "console.log('test')");
    const log = sandbox.getAuditLog(id);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].sandboxId).toBe(id);
  });

  it("should filter audit log by sandbox id", async () => {
    await sandbox.initialize(db);
    const { id: id1 } = sandbox.createSandbox("a1");
    const { id: id2 } = sandbox.createSandbox("a2");
    await sandbox.execute(id1, "code1");
    await sandbox.execute(id2, "code2");
    const log1 = sandbox.getAuditLog(id1);
    expect(log1.every((e) => e.sandboxId === id1)).toBe(true);
  });

  it("should filter audit log by action", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("a1");
    await sandbox.execute(id, "code");
    const log = sandbox.getAuditLog(id, { action: "execute" });
    expect(log.every((e) => e.action === "execute")).toBe(true);
  });

  // --- Quota ---

  it("should set custom quota", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    const quota = sandbox.setQuota(id, {
      cpu: 500,
      memory: 1024 * 1024 * 1024,
    });
    expect(quota.cpu).toBe(500);
    expect(quota.memory).toBe(1024 * 1024 * 1024);
  });

  it("should return null for unknown sandbox quota", async () => {
    await sandbox.initialize(db);
    expect(sandbox.setQuota("nope", { cpu: 1 })).toBeNull();
  });

  // --- Behavior Monitoring ---

  it("should detect no suspicious patterns for clean sandbox", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    await sandbox.execute(id, "clean code");
    const report = sandbox.monitorBehavior(id);
    expect(report.patterns).toHaveLength(0);
    expect(report.riskScore).toBe(0.1);
  });

  it("should detect excessive denied access pattern", async () => {
    await sandbox.initialize(db);
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
    await sandbox.initialize(db);
    expect(sandbox.monitorBehavior("nope")).toBeNull();
  });

  // --- Destroy ---

  it("should destroy a sandbox", async () => {
    await sandbox.initialize(db);
    const { id } = sandbox.createSandbox("agent-1");
    expect(sandbox.destroySandbox(id)).toBe(true);
    expect(sandbox._sandboxes.has(id)).toBe(false);
  });

  it("should return false when destroying unknown sandbox", async () => {
    await sandbox.initialize(db);
    expect(sandbox.destroySandbox("nope")).toBe(false);
  });

  it("should emit sandbox:destroyed event", async () => {
    await sandbox.initialize(db);
    const handler = vi.fn();
    sandbox.on("sandbox:destroyed", handler);
    const { id } = sandbox.createSandbox("agent-1");
    sandbox.destroySandbox(id);
    expect(handler).toHaveBeenCalledWith({ sandboxId: id });
  });
});
