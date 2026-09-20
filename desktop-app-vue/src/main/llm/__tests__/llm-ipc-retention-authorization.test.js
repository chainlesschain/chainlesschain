import { afterEach, describe, expect, it, vi } from "vitest";

const { registerRetentionHandlers } = require("../llm-ipc-retention");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");

function captureHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

describe("LLM retention IPC authorization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails authorization before database access", async () => {
    const prepare = vi.fn();
    const authorize = vi.fn(async () => {
      throw new Error("private-policy-reason");
    });
    const { handlers, ipcMain } = captureHandlers();
    registerRetentionHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
      retentionPrivacy: createLlmIpcPrivacy("retention", {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    });

    await expect(
      handlers.get("llm:cleanup-old-data")({ sender: "renderer" }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "retention",
      operation: "cleanup-old-data",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("binds config and cleanup to the authorized actor", async () => {
    const actorDid = "did:key:retention-owner";
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const row = {
      user_id: actorDid,
      usage_log_retention_days: 30,
      cache_retention_days: 5,
      alert_history_retention_days: 20,
      auto_cleanup_enabled: 1,
      last_cleanup_at: null,
    };
    const get = vi.fn(() => row);
    const run = vi.fn(() => ({ changes: 1 }));
    const prepare = vi.fn((sql) =>
      /SELECT \* FROM llm_data_retention_config/u.test(sql) ? { get } : { run },
    );
    const authorize = vi.fn(async () => ({
      actorDid,
      tenantId: "tenant:retention-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerRetentionHandlers({
      ipcMain,
      database: { prepare, transaction: vi.fn((operation) => operation) },
      coreAuthorization: { authorize },
    });
    const event = Object.freeze({ sender: "renderer" });

    await expect(
      handlers.get("llm:get-retention-config")(event),
    ).resolves.toEqual({
      usageLogRetentionDays: 30,
      cacheRetentionDays: 5,
      alertHistoryRetentionDays: 20,
      autoCleanupEnabled: true,
      lastCleanupAt: 0,
    });
    expect(get).toHaveBeenLastCalledWith(actorDid);

    const setReceipt = await handlers.get("llm:set-retention-config")(event, {
      usageLogRetentionDays: 30,
      cacheRetentionDays: 5,
      alertHistoryRetentionDays: 20,
      autoCleanupEnabled: true,
    });
    expect(setReceipt).toEqual({ success: true });
    expect(Object.isFrozen(setReceipt)).toBe(true);
    expect(run).toHaveBeenLastCalledWith(
      expect.any(String),
      actorDid,
      30,
      5,
      20,
      1,
      now,
      now,
    );

    const cleanupReceipt = await handlers.get("llm:cleanup-old-data")(event);
    expect(cleanupReceipt).toEqual({ success: true });
    expect(Object.isFrozen(cleanupReceipt)).toBe(true);
    expect(run).toHaveBeenCalledWith(now - 30 * 24 * 60 * 60 * 1000, actorDid);
    expect(run).toHaveBeenCalledWith(now - 20 * 24 * 60 * 60 * 1000, actorDid);
    expect(run).toHaveBeenCalledWith(now, now, actorDid);
    expect(prepare.mock.calls.flat().join("\n")).not.toMatch(
      /DELETE FROM llm_cache/u,
    );
    expect(authorize.mock.calls.map((call) => call[1])).toEqual([
      "get-retention-config",
      "set-retention-config",
      "cleanup-old-data",
    ]);
  });

  it("rejects renderer identity fields and hostile retention inputs", async () => {
    const secret = "private-renderer-user";
    const prepare = vi.fn();
    const authorize = vi.fn(async () => ({
      actorDid: "did:key:retention-owner",
      tenantId: "tenant:retention-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerRetentionHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
    });
    const valid = {
      usageLogRetentionDays: 30,
      cacheRetentionDays: 5,
      alertHistoryRetentionDays: 20,
      autoCleanupEnabled: true,
    };

    for (const value of [
      { ...valid, userId: secret },
      { ...valid, usageLogRetentionDays: 3651 },
      { ...valid, autoCleanupEnabled: 1 },
      Object.defineProperty({}, "usageLogRetentionDays", {
        enumerable: true,
        get: () => secret,
      }),
      new Proxy(valid, {
        getOwnPropertyDescriptor() {
          throw new Error(secret);
        },
      }),
    ]) {
      await expect(
        handlers.get("llm:set-retention-config")(null, value),
      ).rejects.toMatchObject({
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "retention",
        operation: "set-retention-config",
      });
    }

    await expect(
      handlers.get("llm:cleanup-old-data")(null, secret),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "cleanup-old-data",
    });
    await expect(
      handlers.get("llm:get-retention-config")(null, secret),
    ).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});
