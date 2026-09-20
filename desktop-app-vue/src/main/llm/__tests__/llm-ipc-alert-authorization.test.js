import { afterEach, describe, expect, it, vi } from "vitest";

const { registerAlertHandlers } = require("../llm-ipc-alert");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");

function captureHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

describe("LLM alert IPC authorization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails authorization before database access", async () => {
    const prepare = vi.fn();
    const authorize = vi.fn(async () => {
      throw new Error("private-policy-reason");
    });
    const { handlers, ipcMain } = captureHandlers();
    registerAlertHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
      alertPrivacy: createLlmIpcPrivacy("alert", {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    });

    await expect(
      handlers.get("llm:get-alert-history")({ sender: "renderer" }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "alert",
      operation: "get-alert-history",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("binds alert reads and mutations to the authorized actor", async () => {
    const actorDid = "did:key:alert-owner";
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const all = vi.fn(() => []);
    const run = vi.fn(() => ({ changes: 1 }));
    const prepare = vi.fn(() => ({ all, run }));
    const authorize = vi.fn(async () => ({
      actorDid,
      tenantId: "tenant:alert-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerAlertHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
    });
    const event = Object.freeze({ sender: "renderer" });

    await expect(
      handlers.get("llm:get-alert-history")(event, {
        limit: 25,
        level: "warning",
        includesDismissed: false,
      }),
    ).resolves.toEqual([]);
    expect(all).toHaveBeenLastCalledWith(actorDid, "warning", 25);

    const addReceipt = await handlers.get("llm:add-alert")(event, {
      type: "budget_warning",
      level: "warning",
      title: "Budget warning",
      message: "Monthly budget reached 80 percent",
      details: {
        budgetType: "monthly",
        percentage: 80,
        spent: 8,
        limit: 10,
      },
      provider: "openai",
      model: "gpt-5",
    });
    expect(addReceipt).toEqual({ success: true });
    expect(Object.isFrozen(addReceipt)).toBe(true);
    expect(run).toHaveBeenLastCalledWith(
      expect.any(String),
      actorDid,
      "budget_warning",
      "warning",
      "Budget warning",
      "Monthly budget reached 80 percent",
      JSON.stringify({
        budgetType: "monthly",
        percentage: 80,
        spent: 8,
        limit: 10,
      }),
      "openai",
      "gpt-5",
      now,
      now,
    );

    await expect(
      handlers.get("llm:dismiss-alert")(event, "alert-1"),
    ).resolves.toEqual({ success: true });
    expect(run).toHaveBeenLastCalledWith(
      now,
      actorDid,
      now,
      "alert-1",
      actorDid,
    );

    await expect(
      handlers.get("llm:clear-alert-history")(event, { olderThanDays: 30 }),
    ).resolves.toEqual({ success: true });
    expect(run).toHaveBeenLastCalledWith(
      actorDid,
      now - 30 * 24 * 60 * 60 * 1000,
    );
    expect(authorize.mock.calls.map((call) => call[1])).toEqual([
      "get-alert-history",
      "add-alert",
      "dismiss-alert",
      "clear-alert-history",
    ]);
  });

  it("rejects renderer identity fields and hostile alert inputs", async () => {
    const secret = "private-renderer-user";
    const prepare = vi.fn();
    const authorize = vi.fn(async () => ({
      actorDid: "did:key:alert-owner",
      tenantId: "tenant:alert-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerAlertHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
    });
    const valid = {
      type: "budget_warning",
      level: "warning",
      title: "Budget warning",
      message: "Budget threshold reached",
    };

    for (const value of [
      { ...valid, userId: secret },
      { ...valid, level: "private-level" },
      { ...valid, details: { limit: 1, extension: secret } },
      Object.defineProperty({ ...valid }, "details", {
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
        handlers.get("llm:add-alert")(null, value),
      ).rejects.toMatchObject({
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "alert",
        operation: "add-alert",
      });
    }

    await expect(
      handlers.get("llm:dismiss-alert")(null, "alert-1", secret),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "dismiss-alert",
    });
    await expect(
      handlers.get("llm:clear-alert-history")(null, { userId: secret }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "clear-alert-history",
    });
    await expect(
      handlers.get("llm:get-alert-history")(null, { userId: secret }),
    ).resolves.toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
