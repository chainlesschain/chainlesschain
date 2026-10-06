import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import policy from "@chainlesschain/session-core/audit-data-policy";
import {
  createAuditDiagnostics,
  logEvent,
  queryLogs,
  exportLogs,
  purgeLogs,
} from "../../src/lib/audit-logger.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  CommandLogger,
} = require("../../../../desktop-app-vue/src/main/remote/logging/command-logger.js");
const BatchedCommandLogger = require("../../../../desktop-app-vue/src/main/remote/logging/batched-command-logger.js");
const { projectAuditMetadata, classifyAuditField } = policy;
const databases = [];
function database() {
  const db = new Database(":memory:");
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("shared audit field policy", () => {
  it("classifies credentials, content, identifiers and metadata consistently", () => {
    expect(classifyAuditField("access_token")).toBe("secret");
    expect(classifyAuditField("sourceSnapshot")).toBe("content");
    expect(classifyAuditField("taskId")).toBe("identifier");
    expect(classifyAuditField("durationMs")).toBe("metadata");
    expect(classifyAuditField("unknown")).toBe("unknown");
  });

  it("drops arbitrary prose, unknown keys, URLs and diagnostics text while keeping metrics", () => {
    const value = projectAuditMetadata({
      description: "business secret",
      sourceSnapshot: { password: "secret" },
      "private value used as a key": "secret",
      prompt: "secret",
      message: "secret",
      accessToken: "secret",
      metrics: { durationMs: 12, retryable: true },
      operation: "https://user:secret@example.test",
      taskId: "task-1",
    });
    expect(value).toMatchObject({
      metrics: { durationMs: 12, retryable: true },
      taskId: "task-1",
    });
    expect(JSON.stringify(value)).not.toMatch(
      /business secret|private value|https:\/\/|"secret"/,
    );
  });

  it("never executes getters, proxies or toJSON and bounds nested input", () => {
    const getter = vi.fn(() => "secret");
    const input = { toJSON: getter };
    Object.defineProperty(input, "count", { get: getter, enumerable: true });
    input.context = input;
    expect(projectAuditMetadata(input)).toEqual({
      context: "[Circular Reference]",
    });
    const proxy = new Proxy({}, { ownKeys: getter });
    expect(projectAuditMetadata(proxy)).toBe("[Content omitted]");
    expect(getter).not.toHaveBeenCalled();
    let deep = { message: "secret" };
    for (let i = 0; i < 1000; i++) deep = { context: deep };
    expect(JSON.stringify(projectAuditMetadata(deep)).length).toBeLessThan(200);
  });

  it("applies policy to CLI persistence and legacy query/export", () => {
    const db = database();
    logEvent(db, {
      eventType: "api",
      operation: "request",
      details: { content: "new secret", count: 2 },
      errorMessage: "arbitrary secret",
      userAgent: "agent secret",
    });
    expect(
      JSON.stringify(db.prepare("SELECT * FROM audit_log").all()),
    ).not.toContain("secret");
    db.prepare("UPDATE audit_log SET details = ?, error_message = ?").run(
      JSON.stringify({ prompt: "legacy secret", count: 4 }),
      "legacy secret",
    );
    expect(queryLogs(db)[0].details.count).toBe(4);
    expect(exportLogs(db)).not.toContain("secret");
    expect(exportLogs(db, "csv")).not.toContain("secret");
  });

  it.each([0, -1, 1.5, NaN, Infinity, 366, "30"])(
    "rejects unsafe purge retention %s",
    (days) => {
      expect(() => purgeLogs(database(), days)).toThrow(/retention/);
    },
  );
});

describe("restricted diagnostic host API", () => {
  it("denies by default and does not initialize storage for denied callers", async () => {
    const db = database();
    const diagnostics = createAuditDiagnostics(db);
    await expect(
      diagnostics.capture("event-1", {}, { admin: true }),
    ).rejects.toMatchObject({ code: "AUDIT_DIAGNOSTICS_DENIED" });
    await expect(diagnostics.read("id", { admin: true })).rejects.toMatchObject(
      { code: "AUDIT_DIAGNOSTICS_DENIED" },
    );
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
    ).toEqual([]);
  });

  it("requires separate write/read authority on every request, redacts and excludes ordinary exports", async () => {
    const db = database();
    let allowRead = true;
    const authorize = vi.fn(
      ({ permission, context }) =>
        context?.principal === "admin" &&
        (permission.endsWith("write") || allowRead),
    );
    const store = createAuditDiagnostics(db, { authorize });
    logEvent(db, { operation: "diagnose" });
    const receipt = await store.capture(
      "event-1",
      {
        metrics: { durationMs: 47 },
        error: { code: "ECONNRESET", message: "secret" },
        password: "secret",
        extra: "secret",
      },
      { principal: "admin" },
    );
    expect(
      (await store.read(receipt.id, { principal: "admin" })).metadata,
    ).toMatchObject({
      metrics: { durationMs: 47 },
      error: { code: "ECONNRESET" },
    });
    expect(exportLogs(db)).not.toContain("ECONNRESET");
    expect(
      JSON.stringify(
        db.prepare("SELECT * FROM restricted_audit_diagnostics").all(),
      ),
    ).not.toContain("secret");
    allowRead = false;
    await expect(
      store.read(receipt.id, { principal: "admin" }),
    ).rejects.toMatchObject({ code: "AUDIT_DIAGNOSTICS_DENIED" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "audit.diagnostics.write",
        resource: { eventId: "event-1" },
      }),
    );
  });

  it("checks event scope after lookup and hides host authorization errors", async () => {
    const db = database();
    const store = createAuditDiagnostics(db, {
      authorize: ({ permission, resource }) =>
        permission.endsWith("write") || !resource.eventId,
    });
    const receipt = await store.capture("event-1", {}, {});
    await expect(store.read(receipt.id, {})).rejects.toMatchObject({
      code: "AUDIT_DIAGNOSTICS_DENIED",
    });
    const broken = createAuditDiagnostics(db, {
      authorize: () => {
        throw new Error("private credential");
      },
    });
    await expect(broken.read(receipt.id, {})).rejects.toThrow(
      "Restricted audit diagnostics access denied",
    );
  });

  it("deletes expired rows after restart and rejects excessive retention", async () => {
    const db = database();
    let now = 100000;
    const options = { authorize: () => true, now: () => now };
    const store = createAuditDiagnostics(db, options);
    const receipt = await store.capture("event-1", { count: 1 }, {});
    expect(receipt.expiresAt - receipt.createdAt).toBe(86400000);
    now = receipt.expiresAt;
    expect(
      await createAuditDiagnostics(db, options).read(receipt.id, {}),
    ).toBeNull();
    expect(
      db
        .prepare("SELECT count(*) AS count FROM restricted_audit_diagnostics")
        .get().count,
    ).toBe(0);
    expect(() => createAuditDiagnostics(db, { retentionDays: 8 })).toThrow(
      /retention/,
    );
  });

  it("rechecks expiration after asynchronous authorization", async () => {
    const db = database();
    let now = 0;
    const store = createAuditDiagnostics(db, {
      now: () => now,
      authorize: ({ permission, resource }) => {
        if (permission.endsWith("read") && resource.eventId) now = 86400000;
        return true;
      },
    });
    const receipt = await store.capture("event-1", { count: 1 }, {});
    expect(await store.read(receipt.id, {})).toBeNull();
  });

  it("wires desktop synchronous and batched loggers, including host diagnostics and emitted envelopes", async () => {
    for (const Logger of [CommandLogger, BatchedCommandLogger]) {
      const db = database();
      const logger = new Logger(db, {
        enableAutoCleanup: false,
        batchInterval: 60000,
        diagnostics: {
          authorize: ({ context }) => context?.principal === "admin",
        },
      });
      try {
        const emitted = vi.fn();
        logger.on("log", emitted);
        logger.log({
          requestId: "request-1",
          deviceDid: "did:test:1",
          deviceName: "private name",
          namespace: "project",
          action: "update",
          params: { description: "business secret", taskId: "task-1" },
          unexpected: "business secret",
        });
        if (logger.forceFlush) await logger.forceFlush();
        expect(JSON.stringify(emitted.mock.calls)).not.toMatch(
          /business secret|private name/,
        );
        expect(
          JSON.stringify(db.prepare("SELECT * FROM remote_command_logs").all()),
        ).not.toMatch(/business secret|private name/);
        const receipt = await logger.captureDiagnostic(
          "request-1",
          { code: "E_TIMEOUT", message: "business secret" },
          { principal: "admin" },
        );
        expect(
          (await logger.readDiagnostic(receipt.id, { principal: "admin" }))
            .metadata.code,
        ).toBe("E_TIMEOUT");
        await expect(
          logger.readDiagnostic(receipt.id, {}),
        ).rejects.toMatchObject({ code: "AUDIT_DIAGNOSTICS_DENIED" });
      } finally {
        if (logger.close) await logger.close();
        else logger.destroy();
      }
    }
  });

  it("uses trusted ingestion time for desktop retention and cleans diagnostic expiry", async () => {
    for (const Logger of [CommandLogger, BatchedCommandLogger]) {
      const db = database();
      let now = 0;
      const logger = new Logger(db, {
        enableAutoCleanup: false,
        batchInterval: 60000,
        diagnostics: { now: () => now, authorize: () => true },
      });
      try {
        logger.log({
          requestId: "request-1",
          deviceDid: "did:test:1",
          namespace: "test",
          action: "run",
          timestamp: Date.now() + 365 * 86400000,
        });
        if (logger.forceFlush) await logger.forceFlush();
        db.prepare(
          "UPDATE remote_command_logs SET created_at = 1, device_name = ?",
        ).run("legacy private name");
        expect(JSON.stringify(logger.query())).not.toContain(
          "legacy private name",
        );
        const diagnostic = await logger.captureDiagnostic(
          "request-1",
          { count: 1 },
          {},
        );
        now = diagnostic.expiresAt;
        logger.cleanup();
        expect(
          db.prepare("SELECT count(*) AS count FROM remote_command_logs").get()
            .count,
        ).toBe(0);
        expect(
          db
            .prepare(
              "SELECT count(*) AS count FROM restricted_audit_diagnostics",
            )
            .get().count,
        ).toBe(0);
      } finally {
        if (logger.close) await logger.close();
        else logger.destroy();
      }
    }
  });

  it("rejects unsafe desktop retention before starting timers", () => {
    for (const Logger of [CommandLogger, BatchedCommandLogger]) {
      expect(() => new Logger(database(), { maxLogAge: -1 })).toThrow(
        /retention/,
      );
      expect(() => new Logger(database(), { maxLogCount: Infinity })).toThrow(
        /retention/,
      );
    }
  });
});
