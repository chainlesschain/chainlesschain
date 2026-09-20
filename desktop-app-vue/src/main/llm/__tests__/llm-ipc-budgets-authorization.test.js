import { describe, expect, it, vi } from "vitest";

const { registerBudgetHandlers } = require("../llm-ipc-budgets");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");

function captureHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

function hostileFailure(secret) {
  return new Proxy(new Error(secret), {
    get() {
      throw new Error("hostile error accessor was invoked");
    },
  });
}

describe("LLM model budget IPC authorization", () => {
  it("fails authorization before database access", async () => {
    const prepare = vi.fn();
    const authorize = vi.fn(async () => {
      throw hostileFailure("private-policy-reason");
    });
    const { handlers, ipcMain } = captureHandlers();
    registerBudgetHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
      budgetPrivacy: createLlmIpcPrivacy("budgets", {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    });

    await expect(
      handlers.get("llm:get-model-budgets")({ sender: "renderer" }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "budgets",
      operation: "get-model-budgets",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("binds reads and writes to the authorized actor", async () => {
    const actorDid = "did:key:budget-owner";
    const all = vi.fn(() => []);
    const run = vi.fn(() => ({ changes: 1 }));
    const prepare = vi.fn(() => ({ all, run }));
    const authorize = vi.fn(async () => ({
      actorDid,
      tenantId: "tenant:budget-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerBudgetHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
    });
    const event = Object.freeze({ sender: "renderer" });

    await expect(handlers.get("llm:get-model-budgets")(event)).resolves.toEqual(
      [],
    );
    expect(all).toHaveBeenCalledWith(actorDid);

    const setReceipt = await handlers.get("llm:set-model-budget")(event, {
      provider: "openai",
      model: "gpt-5",
      dailyLimitUsd: 10,
      weeklyLimitUsd: 50,
      monthlyLimitUsd: 200,
      enabled: true,
      alertOnLimit: false,
      blockOnLimit: true,
    });
    expect(setReceipt).toEqual({ success: true });
    expect(Object.isFrozen(setReceipt)).toBe(true);
    expect(run).toHaveBeenLastCalledWith(
      expect.any(String),
      actorDid,
      "openai",
      "gpt-5",
      10,
      50,
      200,
      1,
      0,
      1,
      expect.any(Number),
      expect.any(Number),
    );

    const deleteReceipt = await handlers.get("llm:delete-model-budget")(event, {
      provider: "openai",
      model: "gpt-5",
    });
    expect(deleteReceipt).toEqual({ success: true });
    expect(Object.isFrozen(deleteReceipt)).toBe(true);
    expect(run).toHaveBeenLastCalledWith(actorDid, "openai", "gpt-5");
    expect(authorize.mock.calls.map((call) => call[1])).toEqual([
      "get-model-budgets",
      "set-model-budget",
      "delete-model-budget",
    ]);
  });

  it("rejects renderer identity fields and hostile budget inputs", async () => {
    const secret = "private-renderer-user";
    const prepare = vi.fn();
    const authorize = vi.fn(async () => ({
      actorDid: "did:key:budget-owner",
      tenantId: "tenant:budget-owner",
    }));
    const { handlers, ipcMain } = captureHandlers();
    registerBudgetHandlers({
      ipcMain,
      database: { prepare },
      coreAuthorization: { authorize },
    });
    const valid = {
      provider: "openai",
      model: "gpt-5",
      dailyLimitUsd: 10,
    };

    for (const value of [
      { ...valid, userId: secret },
      { ...valid, dailyLimitUsd: Number.POSITIVE_INFINITY },
      { ...valid, enabled: 1 },
      Object.defineProperty({ model: "gpt-5" }, "provider", {
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
        handlers.get("llm:set-model-budget")(null, value),
      ).rejects.toMatchObject({
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "budgets",
        operation: "set-model-budget",
      });
    }

    await expect(
      handlers.get("llm:delete-model-budget")(null, {
        provider: "openai",
        model: "gpt-5",
        userId: secret,
      }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "delete-model-budget",
    });
    await expect(
      handlers.get("llm:get-model-budgets")(null, secret),
    ).resolves.toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
