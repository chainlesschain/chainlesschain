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
});
