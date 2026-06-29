/**
 * Tests for two latent fixes in (currently unwired) security modules:
 * - IPCPermissionManager: cleanup-task timer handles are stored + stoppable.
 * - AgentSandboxV2.restoreFromDb: per-row guard on permissions/quota so one
 *   corrupt row doesn't abort restoring every later sandbox.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(),
}));

const {
  IPCPermissionManager,
} = require("../../../src/main/security/ipc-permission-manager.js");
const {
  AgentSandboxV2,
} = require("../../../src/main/security/agent-sandbox-v2.js");

describe("IPCPermissionManager cleanup timers", () => {
  it("stores timer handles and stopCleanupTask releases them", () => {
    const mgr = new IPCPermissionManager();
    mgr.startCleanupTask();
    expect(mgr._rateLimitCleanupTimer).toBeTruthy();
    expect(mgr._auditSaveTimer).toBeTruthy();

    mgr.stopCleanupTask();
    expect(mgr._rateLimitCleanupTimer).toBeNull();
    expect(mgr._auditSaveTimer).toBeNull();
  });

  it("re-running startCleanupTask clears the prior timers (no accumulation)", () => {
    const mgr = new IPCPermissionManager();
    mgr.startCleanupTask();
    const first = mgr._rateLimitCleanupTimer;
    mgr.startCleanupTask();
    expect(mgr._rateLimitCleanupTimer).not.toBe(first);
    mgr.stopCleanupTask();
  });
});

describe("AgentSandboxV2.restoreFromDb per-row guard", () => {
  it("a corrupt permissions/quota row falls back instead of aborting restore", () => {
    const rows = [
      {
        id: "s1",
        agent_id: "a1",
        status: "idle",
        permissions: '{"net":true}',
        quota: '{"cpu":2}',
        policy: "{}",
        created_at_ms: 1,
        last_used_at_ms: 1,
      },
      {
        id: "s2",
        agent_id: "a2",
        status: "idle",
        permissions: "{corrupt",
        quota: "also-bad",
        policy: "{}",
        created_at_ms: 1,
        last_used_at_ms: 1,
      },
    ];
    const sandbox = new AgentSandboxV2();
    // Stub the DB so the test is independent of the native better-sqlite3 ABI.
    sandbox.db = { prepare: () => ({ all: () => rows }) };
    sandbox._sandboxes.clear();

    const restored = sandbox.restoreFromDb();

    // BOTH restored — pre-fix the corrupt row threw and aborted s2 (and any
    // rows after it).
    expect(restored).toBe(2);
    expect(sandbox._sandboxes.get("s1").permissions).toEqual({ net: true });
    // corrupt fields fell back to defaults
    expect(sandbox._sandboxes.get("s2").permissions).toEqual({});
    expect(sandbox._sandboxes.get("s2").quota).toEqual(
      sandbox._config.defaultQuota,
    );
  });
});
