import { describe, expect, it, vi } from "vitest";

const Database = require("better-sqlite3");

const {
  createRemoteCommandAuditProjection,
  deserializeRemoteCommandAuditValue,
  serializeRemoteCommandAuditValue,
} = require("../../../src/main/remote/logging/remote-command-audit-redaction");
const {
  CommandLogger,
} = require("../../../src/main/remote/logging/command-logger");
const BatchedCommandLogger = require("../../../src/main/remote/logging/batched-command-logger");

function createCommandDatabase(insertedRows) {
  return {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT INTO remote_command_logs")) {
        return {
          run: vi.fn((...values) => {
            insertedRows.push(values);
            return { lastInsertRowid: insertedRows.length };
          }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

describe("remote command audit redaction", () => {
  it("creates domain-separated projections without retaining plaintext", () => {
    const secret = "audit-payload-secret";
    const params = createRemoteCommandAuditProjection("params", {
      prompt: secret,
    });
    const result = createRemoteCommandAuditProjection("result", {
      prompt: secret,
    });

    expect(params).toMatchObject({
      schema: "remote-command-audit-redaction/v1",
      label: "params",
      redacted: true,
    });
    expect(params.valueDigest).not.toBe(result.valueDigest);
    expect(JSON.stringify({ params, result })).not.toContain(secret);
  });

  it("redacts legacy plaintext and preserves a valid stored projection", () => {
    const secret = "legacy-audit-secret";
    const legacy = deserializeRemoteCommandAuditValue(
      "error",
      `provider failed: ${secret}`,
    );
    const serialized = serializeRemoteCommandAuditValue("error", secret);
    const restored = deserializeRemoteCommandAuditValue("error", serialized);

    expect(JSON.stringify(legacy)).not.toContain(secret);
    expect(restored).toEqual(JSON.parse(serialized));
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it("redacts synchronous logger storage and emitted payloads", () => {
    const insertedRows = [];
    const commandLogger = new CommandLogger(
      createCommandDatabase(insertedRows),
      { enableAutoCleanup: false },
    );
    const emitted = vi.fn();
    commandLogger.on("log", emitted);
    const secret = "sync-command-secret";

    commandLogger.log({
      requestId: "request-1",
      deviceDid: "device-1",
      namespace: "ai",
      action: "chat",
      params: { prompt: secret },
      result: { content: secret },
      error: new Error(secret),
    });

    expect(JSON.stringify(insertedRows)).not.toContain(secret);
    expect(JSON.stringify(emitted.mock.calls)).not.toContain(secret);
    commandLogger.destroy();
  });

  it("keeps real SQLite rows, reads, and exports free of new plaintext", () => {
    const database = new Database(":memory:");
    const commandLogger = new CommandLogger(database, {
      enableAutoCleanup: false,
    });
    const secret = "sqlite-command-secret";

    const id = commandLogger.log({
      requestId: "request-sqlite",
      deviceDid: "device-sqlite",
      namespace: "project",
      action: "write",
      params: { content: secret },
      result: { path: secret },
      error: secret,
    });
    const raw = database
      .prepare(
        "SELECT params, result, error FROM remote_command_logs WHERE id = ?",
      )
      .get(id);

    expect(JSON.stringify(raw)).not.toContain(secret);
    expect(JSON.stringify(commandLogger.getLogById(id))).not.toContain(secret);
    expect(commandLogger.exportLogs({ format: "json" })).not.toContain(secret);

    commandLogger.destroy();
    database.close();
  });

  it("redacts batched buffers before persistence", async () => {
    const insertedRows = [];
    const database = createCommandDatabase(insertedRows);
    database.transaction = vi.fn((operation) => operation);
    const commandLogger = new BatchedCommandLogger(database, {
      batchSize: 10,
      batchInterval: 60_000,
      enableAutoCleanup: false,
    });
    const secret = "batched-command-secret";

    const normalized = commandLogger.log({
      requestId: "request-2",
      deviceDid: "device-2",
      namespace: "workflow",
      action: "execute",
      params: { input: secret },
      result: { output: secret },
      error: secret,
    });

    expect(JSON.stringify(normalized)).not.toContain(secret);
    expect(JSON.stringify(commandLogger.logBuffer)).not.toContain(secret);
    await commandLogger.close();
    expect(JSON.stringify(insertedRows)).not.toContain(secret);
  });
});
