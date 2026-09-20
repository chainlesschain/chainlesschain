import { describe, expect, it, vi } from "vitest";

const { registerTokenHandlers } = require("../llm-ipc-token");

function captureHandlers(overrides = {}) {
  const handlers = new Map();
  registerTokenHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    managerRef: { current: null },
    database: null,
    tokenTracker: null,
    responseCache: null,
    ...overrides,
  });
  return handlers;
}

function validBudget() {
  return {
    dailyLimit: 5,
    weeklyLimit: 20,
    monthlyLimit: 50,
    warningThreshold: 0.8,
    criticalThreshold: 0.95,
    desktopAlerts: true,
    autoPauseOnLimit: false,
    autoSwitchToCheaperModel: true,
  };
}

describe("LLM token IPC authorization", () => {
  it("fails authorization before accessing token services", async () => {
    const getUsageStats = vi.fn();
    const authorize = vi.fn(async () => {
      throw new Error("private-policy-reason");
    });
    const handlers = captureHandlers({
      tokenTracker: { getUsageStats },
      coreAuthorization: { authorize },
    });

    await expect(
      handlers.get("llm:get-usage-stats")({ sender: "renderer" }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "token",
      operation: "get-usage-stats",
    });
    expect(getUsageStats).not.toHaveBeenCalled();
  });

  it("binds all token operations to the authorized actor and purpose", async () => {
    const actorDid = "did:key:token-owner";
    const authorize = vi.fn(async () => ({
      actorDid,
      tenantId: "tenant:token-owner",
    }));
    const tokenTracker = {
      getUsageStats: vi.fn(async () => ({})),
      getTimeSeriesData: vi.fn(async () => []),
      getCostBreakdown: vi.fn(async () => ({})),
      getBudgetConfig: vi.fn(async () => null),
      saveBudgetConfig: vi.fn(async () => ({ success: true })),
      exportCostReport: vi.fn(async () => ({ success: true })),
    };
    const responseCache = {
      clear: vi.fn(async () => 2),
      clearExpired: vi.fn(async () => 1),
      getStats: vi.fn(async () => ({})),
    };
    const manager = {
      resumeService: vi.fn(async () => ({ success: true })),
      pauseService: vi.fn(async () => ({ success: true })),
      calculateCostEstimate: vi.fn(() => ({})),
      canPerformOperation: vi.fn(async () => ({ allowed: true })),
    };
    const handlers = captureHandlers({
      tokenTracker,
      responseCache,
      managerRef: { current: manager },
      coreAuthorization: { authorize },
    });
    const event = Object.freeze({ sender: "renderer" });

    await handlers.get("llm:get-usage-stats")(event, {
      startDate: 100,
      endDate: 200,
    });
    await handlers.get("llm:get-time-series")(event, {
      startDate: 100,
      endDate: 200,
      interval: "hour",
    });
    await handlers.get("llm:get-cost-breakdown")(event, {
      startDate: 100,
      endDate: 200,
    });
    await handlers.get("llm:get-budget")(event);
    await handlers.get("llm:set-budget")(event, validBudget());
    await handlers.get("llm:export-cost-report")(event, {
      startDate: 100,
      endDate: 200,
      format: "csv",
    });
    await handlers.get("llm:clear-cache")(event, { expiredOnly: false });
    await handlers.get("llm:get-cache-stats")(event);
    await handlers.get("llm:resume-service")(event);
    await handlers.get("llm:pause-service")(event);
    await handlers.get("llm:calculate-cost-estimate")(event, {
      provider: "openai",
      model: "gpt-5",
      inputTokens: 10,
      outputTokens: 5,
    });
    await handlers.get("llm:can-perform-operation")(event, 15);

    expect(tokenTracker.getUsageStats).toHaveBeenCalledWith({
      startDate: 100,
      endDate: 200,
      userId: actorDid,
    });
    expect(tokenTracker.getTimeSeriesData).toHaveBeenCalledWith({
      startDate: 100,
      endDate: 200,
      interval: "hour",
      userId: actorDid,
    });
    expect(tokenTracker.getCostBreakdown).toHaveBeenCalledWith({
      startDate: 100,
      endDate: 200,
      userId: actorDid,
    });
    expect(tokenTracker.getBudgetConfig).toHaveBeenCalledWith(actorDid);
    expect(tokenTracker.saveBudgetConfig).toHaveBeenCalledWith(
      actorDid,
      validBudget(),
    );
    expect(tokenTracker.exportCostReport).toHaveBeenCalledWith({
      startDate: 100,
      endDate: 200,
      format: "csv",
      userId: actorDid,
    });
    expect(responseCache.clear).toHaveBeenCalledOnce();
    expect(responseCache.clearExpired).not.toHaveBeenCalled();
    expect(manager.resumeService).toHaveBeenCalledWith(actorDid);
    expect(manager.canPerformOperation).toHaveBeenCalledWith(15, actorDid);
    expect(authorize.mock.calls.map((call) => call[1])).toEqual([
      "get-usage-stats",
      "get-time-series",
      "get-cost-breakdown",
      "get-budget",
      "set-budget",
      "export-cost-report",
      "clear-cache",
      "get-cache-stats",
      "resume-service",
      "pause-service",
      "calculate-cost-estimate",
      "can-perform-operation",
    ]);
  });

  it("rejects renderer identity fields and hostile token inputs", async () => {
    const secret = "private-renderer-user";
    const rejectIfCalled = vi.fn(() => {
      throw new Error("service should not be called");
    });
    const authorize = vi.fn(async () => ({
      actorDid: "did:key:token-owner",
      tenantId: "tenant:token-owner",
    }));
    const handlers = captureHandlers({
      tokenTracker: {
        getUsageStats: rejectIfCalled,
        saveBudgetConfig: rejectIfCalled,
      },
      responseCache: { clear: rejectIfCalled, clearExpired: rejectIfCalled },
      managerRef: {
        current: {
          calculateCostEstimate: rejectIfCalled,
          canPerformOperation: rejectIfCalled,
        },
      },
      coreAuthorization: { authorize },
    });

    const cases = [
      ["llm:get-usage-stats", [{ userId: secret }]],
      ["llm:get-usage-stats", [{ startDate: 200, endDate: 100 }]],
      ["llm:set-budget", [{ ...validBudget(), userId: secret }]],
      ["llm:set-budget", [{ ...validBudget(), criticalThreshold: 2 }]],
      ["llm:clear-cache", [{ expiredOnly: "yes" }]],
      [
        "llm:calculate-cost-estimate",
        [
          {
            provider: "openai",
            model: "gpt-5",
            inputTokens: 10,
            outputTokens: 5,
            userId: secret,
          },
        ],
      ],
      ["llm:can-perform-operation", [-1]],
    ];
    for (const [channel, args] of cases) {
      await expect(handlers.get(channel)(null, ...args)).rejects.toMatchObject({
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "token",
        operation: channel.slice(4),
      });
    }
    expect(rejectIfCalled).not.toHaveBeenCalled();
  });
});
