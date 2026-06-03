import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSandboxTables,
  createSandbox,
  executeSandbox,
  destroySandbox,
  setPermissions,
  setQuota,
  getSandbox,
  listSandboxes,
  getAuditLog,
  monitorBehavior,
  DEFAULT_QUOTA,
  DEFAULT_PERMISSIONS,
  _resetState,
  acquireSandbox,
  touchSandbox,
  pruneExpired,
  restoreFromDb,
  // Phase 87 V2 additions
  SANDBOX_STATUS,
  PERMISSION_TYPE,
  RISK_LEVEL,
  QUOTA_TYPE,
  pauseSandboxV2,
  resumeSandboxV2,
  terminateSandboxV2,
  setQuotaTyped,
  enforcePermission,
  checkQuotaV2,
  getRiskLevel,
  calculateRiskScore,
  autoIsolate,
  listIsolations,
  filterAuditLog,
  getSandboxStatsV2,
} from "../../src/lib/sandbox-v2.js";

describe("sandbox-v2", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
  });

  // ─── ensureSandboxTables ──────────────────────────────────

  describe("ensureSandboxTables", () => {
    it("creates sandbox_instances table", () => {
      ensureSandboxTables(db);
      expect(db.tables.has("sandbox_instances")).toBe(true);
    });

    it("creates sandbox_audit table", () => {
      ensureSandboxTables(db);
      expect(db.tables.has("sandbox_audit")).toBe(true);
    });

    it("creates sandbox_behavior table", () => {
      ensureSandboxTables(db);
      expect(db.tables.has("sandbox_behavior")).toBe(true);
    });
  });

  // ─── createSandbox ───────────────────────────────────────

  describe("createSandbox", () => {
    it("creates sandbox with default permissions", () => {
      const result = createSandbox(db, "agent-1");
      expect(result.id).toBeTruthy();
      expect(result.status).toBe("active");
      expect(result.permissions).toBeDefined();
      expect(result.quota).toBeDefined();
    });

    it("creates sandbox with custom permissions", () => {
      const customPerms = {
        fileSystem: {
          read: ["/home/user"],
          write: ["/home/user/data"],
          denied: ["/etc"],
        },
        network: {
          allowed: ["api.example.com"],
          denied: ["evil.com"],
          maxConnections: 5,
        },
        systemCalls: {
          allowed: ["read", "write"],
          denied: ["exec"],
        },
      };
      const result = createSandbox(db, "agent-2", {
        permissions: customPerms,
      });
      expect(result.permissions.fileSystem.read).toEqual(["/home/user"]);
      expect(result.permissions.network.allowed).toEqual(["api.example.com"]);
    });

    it("creates sandbox with custom quota", () => {
      const customQuota = {
        cpu: 50,
        memory: 128 * 1024 * 1024,
        storage: 50 * 1024 * 1024,
        network: 500,
      };
      const result = createSandbox(db, "agent-3", { quota: customQuota });
      expect(result.quota.cpu).toBe(50);
      expect(result.quota.memory).toBe(128 * 1024 * 1024);
    });

    it("logs creation in audit", () => {
      const result = createSandbox(db, "agent-4");
      const audit = getAuditLog(db, result.id);
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0].action).toBe("create");
    });
  });

  // ─── executeSandbox ───────────────────────────────────────

  describe("executeSandbox", () => {
    it("executes code successfully", () => {
      const sandbox = createSandbox(db, "agent-5");
      const result = executeSandbox(db, sandbox.id, "console.log('hello')");
      expect(result.exitCode).toBe(0);
      expect(result.output).toBeTruthy();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.resourceUsage).toBeDefined();
    });

    it("throws for non-existent sandbox", () => {
      expect(() => executeSandbox(db, "nonexistent", "code")).toThrow(
        "not found or not active",
      );
    });

    it("throws on denied file access", () => {
      const sandbox = createSandbox(db, "agent-6", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          fileSystem: { read: ["/tmp"], write: ["/tmp"], denied: ["/etc"] },
        },
      });
      expect(() =>
        executeSandbox(db, sandbox.id, "read /etc/passwd", {
          filePath: "/etc/passwd",
          fileMode: "read",
        }),
      ).toThrow("Permission denied");
    });

    it("throws on denied network access", () => {
      const sandbox = createSandbox(db, "agent-7", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          network: {
            allowed: ["localhost"],
            denied: ["evil.com"],
            maxConnections: 10,
          },
        },
      });
      expect(() =>
        executeSandbox(db, sandbox.id, "fetch evil.com", {
          host: "evil.com",
        }),
      ).toThrow("Permission denied");
    });

    it("throws on denied system call", () => {
      const sandbox = createSandbox(db, "agent-8", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          systemCalls: { allowed: ["read"], denied: ["exec"] },
        },
      });
      expect(() =>
        executeSandbox(db, sandbox.id, "exec /bin/sh", {
          systemCall: "exec",
        }),
      ).toThrow("Permission denied");
    });

    it("tracks resource usage across executions", () => {
      const sandbox = createSandbox(db, "agent-9");
      executeSandbox(db, sandbox.id, "code1");
      executeSandbox(db, sandbox.id, "code2");
      const result = executeSandbox(db, sandbox.id, "code3");
      expect(result.resourceUsage.cpu).toBe(3);
    });

    it("throws when CPU quota exceeded", () => {
      const sandbox = createSandbox(db, "agent-10", {
        quota: {
          cpu: 2,
          memory: 256 * 1024 * 1024,
          storage: 100 * 1024 * 1024,
          network: 1000,
        },
      });
      executeSandbox(db, sandbox.id, "a");
      executeSandbox(db, sandbox.id, "b");
      expect(() => executeSandbox(db, sandbox.id, "c")).toThrow(
        "Quota exceeded: CPU limit reached",
      );
    });
  });

  // ─── destroySandbox ───────────────────────────────────────

  describe("destroySandbox", () => {
    it("destroys an active sandbox", () => {
      const sandbox = createSandbox(db, "agent-11");
      const result = destroySandbox(db, sandbox.id);
      expect(result.status).toBe("destroyed");
    });

    it("throws for non-existent sandbox", () => {
      expect(() => destroySandbox(db, "nonexistent")).toThrow("not found");
    });

    it("prevents execution after destroy", () => {
      const sandbox = createSandbox(db, "agent-12");
      destroySandbox(db, sandbox.id);
      expect(() => executeSandbox(db, sandbox.id, "code")).toThrow(
        "not found or not active",
      );
    });
  });

  // ─── setPermissions / setQuota ────────────────────────────

  describe("setPermissions", () => {
    it("updates permissions", () => {
      const sandbox = createSandbox(db, "agent-13");
      const newPerms = {
        fileSystem: { read: ["/new"], write: [], denied: [] },
        network: { allowed: ["*"], denied: [], maxConnections: 100 },
        systemCalls: { allowed: ["*"], denied: [] },
      };
      const result = setPermissions(db, sandbox.id, newPerms);
      expect(result.permissions.network.allowed).toEqual(["*"]);
    });

    it("throws for non-existent sandbox", () => {
      expect(() => setPermissions(db, "nope", {})).toThrow("not found");
    });
  });

  describe("setQuota", () => {
    it("updates quota", () => {
      const sandbox = createSandbox(db, "agent-14");
      const newQuota = {
        cpu: 200,
        memory: 512 * 1024 * 1024,
        storage: 200 * 1024 * 1024,
        network: 2000,
      };
      const result = setQuota(db, sandbox.id, newQuota);
      expect(result.quota.cpu).toBe(200);
    });

    it("throws for non-existent sandbox", () => {
      expect(() => setQuota(db, "nope", {})).toThrow("not found");
    });
  });

  // ─── getSandbox / listSandboxes ───────────────────────────

  describe("getSandbox", () => {
    it("returns sandbox info", () => {
      const sandbox = createSandbox(db, "agent-15");
      const info = getSandbox(db, sandbox.id);
      expect(info.id).toBe(sandbox.id);
      expect(info.agentId).toBe("agent-15");
      expect(info.status).toBe("active");
    });

    it("returns null for non-existent sandbox", () => {
      ensureSandboxTables(db);
      const info = getSandbox(db, "nonexistent");
      expect(info).toBeNull();
    });
  });

  describe("listSandboxes", () => {
    it("lists active sandboxes", () => {
      createSandbox(db, "a1");
      createSandbox(db, "a2");
      const list = listSandboxes(db);
      expect(list.length).toBe(2);
    });

    it("excludes destroyed sandboxes", () => {
      const s1 = createSandbox(db, "a3");
      createSandbox(db, "a4");
      destroySandbox(db, s1.id);
      const list = listSandboxes(db);
      expect(list.length).toBe(1);
    });
  });

  // ─── getAuditLog ──────────────────────────────────────────

  describe("getAuditLog", () => {
    it("returns all audit entries for a sandbox", () => {
      const sandbox = createSandbox(db, "agent-16");
      executeSandbox(db, sandbox.id, "code");
      const log = getAuditLog(db, sandbox.id);
      expect(log.length).toBeGreaterThanOrEqual(2); // create + execute
    });

    it("filters by action", () => {
      const sandbox = createSandbox(db, "agent-17");
      executeSandbox(db, sandbox.id, "code");
      const log = getAuditLog(db, sandbox.id, { action: "execute" });
      expect(log.every((e) => e.action === "execute")).toBe(true);
    });

    it("respects limit", () => {
      const sandbox = createSandbox(db, "agent-18");
      executeSandbox(db, sandbox.id, "a");
      executeSandbox(db, sandbox.id, "b");
      executeSandbox(db, sandbox.id, "c");
      const log = getAuditLog(db, sandbox.id, { limit: 2 });
      expect(log.length).toBe(2);
    });
  });

  // ─── monitorBehavior ──────────────────────────────────────

  describe("monitorBehavior", () => {
    it("returns empty patterns for clean sandbox", () => {
      const sandbox = createSandbox(db, "agent-19");
      executeSandbox(db, sandbox.id, "good code");
      const result = monitorBehavior(db, sandbox.id);
      expect(result.patterns.length).toBe(0);
      expect(result.riskScore).toBe(0);
    });

    it("detects excessive denied access pattern", () => {
      const sandbox = createSandbox(db, "agent-20", {
        permissions: {
          fileSystem: { read: [], write: [], denied: ["/"] },
          network: { allowed: [], denied: [], maxConnections: 0 },
          systemCalls: { allowed: [], denied: [] },
        },
      });
      // Trigger >10 denied access attempts
      for (let i = 0; i < 12; i++) {
        try {
          executeSandbox(db, sandbox.id, "read /secret", {
            filePath: "/secret",
            fileMode: "read",
          });
        } catch (_err) {
          // Expected permission denied
        }
      }
      const result = monitorBehavior(db, sandbox.id);
      const deniedPattern = result.patterns.find(
        (p) => p.type === "excessive-denied-access",
      );
      expect(deniedPattern).toBeDefined();
      expect(deniedPattern.severity).toBe("high");
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it("reports total events count", () => {
      const sandbox = createSandbox(db, "agent-21");
      executeSandbox(db, sandbox.id, "a");
      executeSandbox(db, sandbox.id, "b");
      const result = monitorBehavior(db, sandbox.id);
      expect(result.totalEvents).toBeGreaterThanOrEqual(3); // create + 2 execute
    });
  });

  // ─── DEFAULT constants ────────────────────────────────────

  describe("constants", () => {
    it("DEFAULT_QUOTA has expected fields", () => {
      expect(DEFAULT_QUOTA.cpu).toBe(100);
      expect(DEFAULT_QUOTA.memory).toBe(256 * 1024 * 1024);
      expect(DEFAULT_QUOTA.storage).toBe(100 * 1024 * 1024);
      expect(DEFAULT_QUOTA.network).toBe(1000);
    });

    describe("Phase 4: bundle-aware lifecycle", () => {
      it("createSandbox attaches a default policy", () => {
        const { id } = createSandbox(db, "agent-1", {
          policy: { scope: "assistant" },
        });
        // Reuse via acquireSandbox to confirm policy.scope landed
        const again = acquireSandbox(db, "agent-1", {
          policy: { scope: "assistant" },
        });
        expect(again.reused).toBe(true);
        expect(again.id).toBe(id);
        expect(again.scope).toBe("assistant");
      });

      it("acquireSandbox creates a new thread sandbox by default", () => {
        const out = acquireSandbox(db, "agent-1");
        expect(out.reused).toBe(false);
        expect(out.scope).toBe("thread");
      });

      it("acquireSandbox does not reuse across agents", () => {
        const a = acquireSandbox(db, "agent-1", {
          policy: { scope: "assistant" },
        });
        const b = acquireSandbox(db, "agent-2", {
          policy: { scope: "assistant" },
        });
        expect(b.reused).toBe(false);
        expect(b.id).not.toBe(a.id);
      });

      it("touchSandbox refreshes lastUsedAtMs", () => {
        const { id } = createSandbox(db, "agent-1");
        expect(touchSandbox(id)).toBe(true);
        expect(touchSandbox("nope")).toBe(false);
      });

      it("pruneExpired destroys ttl-expired sandboxes", () => {
        const { id } = createSandbox(db, "agent-1", {
          policy: { scope: "thread", ttlMs: 10, idleTtlMs: null },
        });
        // Force createdAtMs into the past by reaching into active map.
        // destroySandbox check uses Date.now() - createdAtMs > ttlMs.
        const out = pruneExpired(db, Date.now() + 1000);
        expect(out.find((x) => x.id === id)?.reason).toBe("ttl");
      });

      it("pruneExpired ignores sandboxes with null ttls", () => {
        createSandbox(db, "agent-1", {
          policy: { ttlMs: null, idleTtlMs: null },
        });
        expect(pruneExpired(db, Date.now() + 10_000_000)).toEqual([]);
      });

      it("createSandbox persists policy + ms timestamps to DB", () => {
        const { id } = createSandbox(db, "agent-persist", {
          policy: { scope: "assistant", ttlMs: 5000 },
        });
        const row = db
          .prepare(`SELECT * FROM sandbox_instances WHERE id = ?`)
          .get(id);
        expect(row).toBeTruthy();
        expect(typeof row.created_at_ms).toBe("number");
        expect(typeof row.last_used_at_ms).toBe("number");
        const persistedPolicy = JSON.parse(row.policy);
        expect(persistedPolicy.scope).toBe("assistant");
      });

      it("touchSandbox(id, db) syncs last_used_at_ms to DB", () => {
        const { id } = createSandbox(db, "agent-touch");
        const before = db
          .prepare(`SELECT last_used_at_ms FROM sandbox_instances WHERE id = ?`)
          .get(id).last_used_at_ms;
        // Advance real clock slightly by busy-waiting 2ms
        const target = Date.now() + 2;
        while (Date.now() < target) {
          /* spin */
        }
        expect(touchSandbox(id, db)).toBe(true);
        const after = db
          .prepare(`SELECT last_used_at_ms FROM sandbox_instances WHERE id = ?`)
          .get(id).last_used_at_ms;
        expect(after).toBeGreaterThanOrEqual(before);
      });

      it("restoreFromDb rehydrates active rows into the in-memory map", () => {
        const { id } = createSandbox(db, "agent-restore", {
          policy: { scope: "assistant" },
        });
        _resetState();
        expect(restoreFromDb(db)).toBe(1);
        const info = getSandbox(db, id);
        expect(info).toBeTruthy();
        expect(info.agentId).toBe("agent-restore");
      });

      it("restoreFromDb skips destroyed rows", () => {
        const { id } = createSandbox(db, "agent-gone");
        destroySandbox(db, id);
        _resetState();
        expect(restoreFromDb(db)).toBe(0);
      });

      it("acquireSandbox lazily rehydrates persisted state across restarts", () => {
        // Seed a reusable assistant-scope sandbox, then wipe in-memory state
        // to simulate a CLI restart. The second acquireSandbox call should
        // rehydrate from DB and reuse instead of creating a fresh sandbox.
        const first = acquireSandbox(db, "agent-reboot", {
          policy: { scope: "assistant" },
        });
        expect(first.reused).toBe(false);
        _resetState();

        const second = acquireSandbox(db, "agent-reboot", {
          policy: { scope: "assistant" },
        });
        expect(second.id).toBe(first.id);
        expect(second.reused).toBe(true);
      });

      it("pruneExpired lazily rehydrates persisted state across restarts", () => {
        const { id } = createSandbox(db, "agent-idle", {
          policy: { scope: "thread", idleTtlMs: 100 },
        });
        _resetState();

        const destroyed = pruneExpired(db, Date.now() + 10_000);
        expect(destroyed.some((d) => d.id === id)).toBe(true);
      });
    });

    it("DEFAULT_PERMISSIONS has expected structure", () => {
      expect(DEFAULT_PERMISSIONS.fileSystem).toBeDefined();
      expect(DEFAULT_PERMISSIONS.network).toBeDefined();
      expect(DEFAULT_PERMISSIONS.systemCalls).toBeDefined();
      expect(Array.isArray(DEFAULT_PERMISSIONS.fileSystem.read)).toBe(true);
      expect(Array.isArray(DEFAULT_PERMISSIONS.network.allowed)).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Phase 87 — Agent Security Sandbox 2.0 additions
  // ═════════════════════════════════════════════════════════════════

  describe("Phase 87 frozen enums", () => {
    it("SANDBOX_STATUS has 6 values and is frozen", () => {
      expect(Object.values(SANDBOX_STATUS).sort()).toEqual(
        [
          "creating",
          "error",
          "paused",
          "ready",
          "running",
          "terminated",
        ].sort(),
      );
      expect(Object.isFrozen(SANDBOX_STATUS)).toBe(true);
    });

    it("PERMISSION_TYPE has 5 values and is frozen", () => {
      expect(Object.values(PERMISSION_TYPE).sort()).toEqual(
        ["filesystem", "ipc", "network", "process", "syscall"].sort(),
      );
      expect(Object.isFrozen(PERMISSION_TYPE)).toBe(true);
    });

    it("RISK_LEVEL has 5 values and is frozen", () => {
      expect(Object.values(RISK_LEVEL).sort()).toEqual(
        ["critical", "high", "low", "medium", "safe"].sort(),
      );
      expect(Object.isFrozen(RISK_LEVEL)).toBe(true);
    });

    it("QUOTA_TYPE has 5 values and is frozen", () => {
      expect(Object.values(QUOTA_TYPE).sort()).toEqual(
        [
          "cpu_percent",
          "disk_mb",
          "memory_mb",
          "network_kbps",
          "process_count",
        ].sort(),
      );
      expect(Object.isFrozen(QUOTA_TYPE)).toBe(true);
    });
  });

  describe("pauseSandboxV2 / resumeSandboxV2 / terminateSandboxV2", () => {
    it("pauseSandboxV2 transitions active → paused", () => {
      const { id } = createSandbox(db, "agent-p1");
      const r = pauseSandboxV2(db, id);
      expect(r.status).toBe(SANDBOX_STATUS.PAUSED);
      expect(r.previousStatus).toBe("active");
      expect(getSandbox(db, id).status).toBe(SANDBOX_STATUS.PAUSED);
    });

    it("pauseSandboxV2 throws when already paused", () => {
      const { id } = createSandbox(db, "agent-p2");
      pauseSandboxV2(db, id);
      expect(() => pauseSandboxV2(db, id)).toThrow(/already paused/);
    });

    it("pauseSandboxV2 throws for unknown sandbox", () => {
      expect(() => pauseSandboxV2(db, "unknown-id")).toThrow(/not found/);
    });

    it("resumeSandboxV2 transitions paused → active", () => {
      const { id } = createSandbox(db, "agent-r1");
      pauseSandboxV2(db, id);
      const r = resumeSandboxV2(db, id);
      expect(r.status).toBe("active");
      expect(getSandbox(db, id).status).toBe("active");
    });

    it("resumeSandboxV2 throws if not paused", () => {
      const { id } = createSandbox(db, "agent-r2");
      expect(() => resumeSandboxV2(db, id)).toThrow(/not paused/);
    });

    it("terminateSandboxV2 removes from activeSandboxes + records reason", () => {
      const { id } = createSandbox(db, "agent-t1");
      const r = terminateSandboxV2(db, id, "admin-kill");
      expect(r.status).toBe(SANDBOX_STATUS.TERMINATED);
      expect(r.reason).toBe("admin-kill");
      // DB row persists with TERMINATED status; in-memory entry is gone
      expect(getSandbox(db, id).status).toBe(SANDBOX_STATUS.TERMINATED);
    });

    it("terminateSandboxV2 throws for unknown sandbox", () => {
      expect(() => terminateSandboxV2(db, "unknown-id")).toThrow(/not found/);
    });
  });

  describe("setQuotaTyped + checkQuotaV2", () => {
    it("setQuotaTyped merges single quota field", () => {
      const { id } = createSandbox(db, "agent-q1");
      const before = getSandbox(db, id).quota;
      const r = setQuotaTyped(db, id, QUOTA_TYPE.MEMORY_MB, 128);
      expect(r.quotaType).toBe(QUOTA_TYPE.MEMORY_MB);
      expect(r.limit).toBe(128);
      expect(r.quota.memory).toBe(128);
      // other fields preserved
      expect(r.quota.cpu).toBe(before.cpu);
    });

    it("setQuotaTyped rejects unknown quota type", () => {
      const { id } = createSandbox(db, "agent-q2");
      expect(() => setQuotaTyped(db, id, "garbage", 10)).toThrow(
        /Invalid quotaType/,
      );
    });

    it("setQuotaTyped rejects negative limit", () => {
      const { id } = createSandbox(db, "agent-q3");
      expect(() => setQuotaTyped(db, id, QUOTA_TYPE.CPU_PERCENT, -1)).toThrow(
        /Invalid limit/,
      );
    });

    it("checkQuotaV2 returns ok=true when within limit", () => {
      const { id } = createSandbox(db, "agent-q4");
      setQuotaTyped(db, id, QUOTA_TYPE.MEMORY_MB, 256);
      const sandbox = getSandbox(db, id);
      const r = checkQuotaV2(sandbox, QUOTA_TYPE.MEMORY_MB, 100);
      expect(r.ok).toBe(true);
      expect(r.limit).toBe(256);
      expect(r.current).toBe(100);
      expect(r.remaining).toBe(156);
    });

    it("checkQuotaV2 returns ok=false when over limit", () => {
      const { id } = createSandbox(db, "agent-q5");
      setQuotaTyped(db, id, QUOTA_TYPE.MEMORY_MB, 50);
      const sandbox = getSandbox(db, id);
      const r = checkQuotaV2(sandbox, QUOTA_TYPE.MEMORY_MB, 200);
      expect(r.ok).toBe(false);
      expect(r.remaining).toBe(0);
    });
  });

  describe("enforcePermission", () => {
    it("allows filesystem read within permissions", () => {
      const { id } = createSandbox(db, "agent-e1", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          fileSystem: { read: ["/tmp"], write: [], denied: [] },
        },
      });
      const r = enforcePermission(getSandbox(db, id), {
        type: PERMISSION_TYPE.FILESYSTEM,
        target: "/tmp/foo.txt",
        mode: "read",
      });
      expect(r.allowed).toBe(true);
    });

    it("denies filesystem read outside permissions", () => {
      const { id } = createSandbox(db, "agent-e2", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          fileSystem: { read: ["/tmp"], write: [], denied: [] },
        },
      });
      const r = enforcePermission(getSandbox(db, id), {
        type: PERMISSION_TYPE.FILESYSTEM,
        target: "/etc/passwd",
        mode: "read",
      });
      expect(r.allowed).toBe(false);
    });

    it("throws on denied when throwOnDeny=true", () => {
      const { id } = createSandbox(db, "agent-e3", {
        permissions: {
          ...DEFAULT_PERMISSIONS,
          fileSystem: { read: ["/tmp"], write: [], denied: [] },
        },
      });
      expect(() =>
        enforcePermission(getSandbox(db, id), {
          type: PERMISSION_TYPE.FILESYSTEM,
          target: "/etc/passwd",
          mode: "read",
          throwOnDeny: true,
        }),
      ).toThrow(/Permission denied/);
    });

    it("rejects invalid permission type", () => {
      const { id } = createSandbox(db, "agent-e4");
      expect(() =>
        enforcePermission(getSandbox(db, id), {
          type: "bogus",
          target: "x",
        }),
      ).toThrow(/Invalid permission type/);
    });

    it("denies IPC by default (deny-by-default stub)", () => {
      const { id } = createSandbox(db, "agent-e5");
      const r = enforcePermission(getSandbox(db, id), {
        type: PERMISSION_TYPE.IPC,
        target: "some-channel",
      });
      expect(r.allowed).toBe(false);
    });
  });

  describe("getRiskLevel + calculateRiskScore", () => {
    it("getRiskLevel buckets correctly", () => {
      expect(getRiskLevel(0)).toBe(RISK_LEVEL.SAFE);
      expect(getRiskLevel(19)).toBe(RISK_LEVEL.SAFE);
      expect(getRiskLevel(20)).toBe(RISK_LEVEL.LOW);
      expect(getRiskLevel(39)).toBe(RISK_LEVEL.LOW);
      expect(getRiskLevel(40)).toBe(RISK_LEVEL.MEDIUM);
      expect(getRiskLevel(59)).toBe(RISK_LEVEL.MEDIUM);
      expect(getRiskLevel(60)).toBe(RISK_LEVEL.HIGH);
      expect(getRiskLevel(79)).toBe(RISK_LEVEL.HIGH);
      expect(getRiskLevel(80)).toBe(RISK_LEVEL.CRITICAL);
      expect(getRiskLevel(100)).toBe(RISK_LEVEL.CRITICAL);
    });

    it("getRiskLevel handles non-number input", () => {
      expect(getRiskLevel(null)).toBe(RISK_LEVEL.SAFE);
      expect(getRiskLevel(undefined)).toBe(RISK_LEVEL.SAFE);
      expect(getRiskLevel("not-a-number")).toBe(RISK_LEVEL.SAFE);
    });

    it("calculateRiskScore returns safe for fresh sandbox", () => {
      const { id } = createSandbox(db, "agent-risk");
      const r = calculateRiskScore(db, id);
      expect(r.sandboxId).toBe(id);
      expect(r.riskScore).toBe(0);
      expect(r.riskLevel).toBe(RISK_LEVEL.SAFE);
      expect(Array.isArray(r.patterns)).toBe(true);
    });
  });

  describe("autoIsolate + listIsolations", () => {
    it("autoIsolate terminates sandbox and records entry", () => {
      const { id } = createSandbox(db, "agent-iso1");
      const entry = autoIsolate(db, id, "critical-risk");
      expect(entry.sandboxId).toBe(id);
      expect(entry.reason).toBe("critical-risk");
      expect(entry.isolatedAt).toBeTruthy();
      expect(getSandbox(db, id).status).toBe(SANDBOX_STATUS.TERMINATED);
    });

    it("listIsolations returns all entries", () => {
      const { id: id1 } = createSandbox(db, "agent-iso2");
      const { id: id2 } = createSandbox(db, "agent-iso3");
      autoIsolate(db, id1, "high-risk");
      autoIsolate(db, id2, "admin-request");
      expect(listIsolations()).toHaveLength(2);
    });

    it("listIsolations filters by reason", () => {
      const { id: id1 } = createSandbox(db, "agent-iso4");
      const { id: id2 } = createSandbox(db, "agent-iso5");
      autoIsolate(db, id1, "high-risk");
      autoIsolate(db, id2, "admin-request");
      const r = listIsolations({ reason: "high-risk" });
      expect(r).toHaveLength(1);
      expect(r[0].sandboxId).toBe(id1);
    });

    it("listIsolations filters by sandboxId", () => {
      const { id: id1 } = createSandbox(db, "agent-iso6");
      const { id: id2 } = createSandbox(db, "agent-iso7");
      autoIsolate(db, id1, "r1");
      autoIsolate(db, id2, "r2");
      const r = listIsolations({ sandboxId: id2 });
      expect(r).toHaveLength(1);
      expect(r[0].reason).toBe("r2");
    });
  });

  describe("filterAuditLog", () => {
    it("filters by sandboxId", () => {
      const { id } = createSandbox(db, "agent-a1");
      pauseSandboxV2(db, id);
      resumeSandboxV2(db, id);
      const entries = filterAuditLog(db, id);
      expect(entries.length).toBeGreaterThanOrEqual(3); // create+pause+resume
      expect(entries.every((e) => e.sandboxId === id)).toBe(true);
    });

    it("filters by event types", () => {
      const { id } = createSandbox(db, "agent-a2");
      pauseSandboxV2(db, id);
      resumeSandboxV2(db, id);
      const pauseOnly = filterAuditLog(db, id, { eventTypes: ["pause"] });
      expect(pauseOnly.every((e) => e.action === "pause")).toBe(true);
      expect(pauseOnly).toHaveLength(1);
    });

    it("respects limit option", () => {
      const { id } = createSandbox(db, "agent-a3");
      pauseSandboxV2(db, id);
      resumeSandboxV2(db, id);
      const last = filterAuditLog(db, id, { limit: 1 });
      expect(last).toHaveLength(1);
    });
  });

  describe("getSandboxStatsV2", () => {
    it("returns totalSandboxes and byStatus breakdown", () => {
      createSandbox(db, "agent-s1");
      const { id: id2 } = createSandbox(db, "agent-s2");
      pauseSandboxV2(db, id2);
      const stats = getSandboxStatsV2();
      expect(stats.totalSandboxes).toBe(2);
      expect(stats.byStatus.active).toBe(1);
      expect(stats.byStatus.paused).toBe(1);
    });

    it("includes audit-by-action summary", () => {
      const { id } = createSandbox(db, "agent-s3");
      pauseSandboxV2(db, id);
      const stats = getSandboxStatsV2();
      expect(stats.auditByAction.create).toBeGreaterThanOrEqual(1);
      expect(stats.auditByAction.pause).toBe(1);
    });

    it("includes isolations summary", () => {
      const { id } = createSandbox(db, "agent-s4");
      autoIsolate(db, id, "test");
      const stats = getSandboxStatsV2();
      expect(stats.isolations.total).toBe(1);
      expect(stats.isolations.byReason.test).toBe(1);
    });

    it("handles empty state", () => {
      const stats = getSandboxStatsV2();
      expect(stats.totalSandboxes).toBe(0);
      expect(stats.isolations.total).toBe(0);
    });
  });
});
