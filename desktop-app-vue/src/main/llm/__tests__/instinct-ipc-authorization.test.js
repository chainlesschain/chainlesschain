import { describe, expect, it, vi } from "vitest";

const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const { INSTINCT_CHANNELS, registerInstinctIPC } = require("../instinct-ipc");

function captureHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

function privacy() {
  return createLlmIpcPrivacy("instinct", {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
}

function instinct(overrides = {}) {
  return {
    id: "instinct-1",
    pattern: "Prefer focused regression tests",
    confidence: 0.8,
    category: "testing",
    examples: ["Run the smallest relevant suite"],
    source: "manual",
    useCount: 4,
    createdAt: "private-created-at",
    metadata: { secret: true },
    ...overrides,
  };
}

describe("instinct IPC authorization and privacy", () => {
  it("authorizes before manager access and registers every channel", async () => {
    const manager = { getAll: vi.fn() };
    const authorize = vi.fn(async () => {
      throw new Error("private-policy-reason");
    });
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(manager, {
      ipcMain,
      coreAuthorization: { authorize },
      privacy: privacy(),
    });

    expect(handlers.size).toBe(INSTINCT_CHANNELS.length);
    expect(new Set(handlers.keys())).toEqual(new Set(INSTINCT_CHANNELS));
    await expect(
      handlers.get("instinct:get-all")({}, {}),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "instinct",
      operation: "instinct-get-all",
    });
    expect(manager.getAll).not.toHaveBeenCalled();
  });

  it("normalizes reads and projects instinct records", async () => {
    const manager = {
      getAll: vi.fn(() => [instinct(), { hostile: true }]),
      getRelevantInstincts: vi.fn(() => [instinct()]),
    };
    const authorize = vi.fn(async () => ({ actorDid: "did:key:owner" }));
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(manager, {
      ipcMain,
      coreAuthorization: { authorize },
      privacy: privacy(),
    });

    const list = await handlers.get("instinct:get-all")(
      {},
      {
        category: "testing",
        minConfidence: 0.5,
        source: "manual",
        orderBy: "confidence DESC",
        limit: 10,
      },
    );
    expect(manager.getAll).toHaveBeenCalledWith({
      category: "testing",
      minConfidence: 0.5,
      source: "manual",
      orderBy: "confidence DESC",
      limit: 10,
    });
    expect(list).toEqual({
      success: true,
      data: [
        {
          id: "instinct-1",
          pattern: "Prefer focused regression tests",
          confidence: 0.8,
          category: "testing",
          source: "manual",
          useCount: 4,
        },
      ],
    });
    expect(JSON.stringify(list)).not.toContain("private-created-at");
    expect(JSON.stringify(list)).not.toContain("metadata");

    await expect(
      handlers.get("instinct:get-relevant")({}, "test failures", 5),
    ).resolves.toEqual(list);
    expect(manager.getRelevantInstincts).toHaveBeenCalledWith(
      "test failures",
      5,
    );
  });

  it("normalizes mutations and returns bounded receipts", async () => {
    const record = instinct();
    const manager = {
      addInstinct: vi.fn(() => record),
      updateInstinct: vi.fn(() => record),
      deleteInstinct: vi.fn(() => true),
      reinforceInstinct: vi.fn(() => record),
      decayInstinct: vi.fn(() => record),
    };
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(manager, {
      ipcMain,
      coreAuthorization: { authorize: vi.fn(async () => true) },
      privacy: privacy(),
    });

    await handlers.get("instinct:add")(
      {},
      {
        pattern: record.pattern,
        confidence: 0.8,
        category: "testing",
        examples: ["Run the smallest relevant suite"],
      },
    );
    expect(manager.addInstinct).toHaveBeenCalledWith(
      record.pattern,
      0.8,
      "testing",
      { source: "manual", examples: ["Run the smallest relevant suite"] },
    );

    await handlers.get("instinct:update")({}, "instinct-1", {
      confidence: 0.9,
    });
    expect(manager.updateInstinct).toHaveBeenCalledWith("instinct-1", {
      confidence: 0.9,
    });

    await expect(
      handlers.get("instinct:delete")({}, "instinct-1"),
    ).resolves.toEqual({ success: true });
    await handlers.get("instinct:reinforce")({}, "instinct-1");
    await handlers.get("instinct:decay")({}, "instinct-1");
    expect(manager.reinforceInstinct).toHaveBeenCalledWith("instinct-1");
    expect(manager.decayInstinct).toHaveBeenCalledWith("instinct-1");
  });

  it("projects evolution, export, import and statistics", async () => {
    const manager = {
      evolveInstincts: vi.fn(async () => ({
        success: true,
        observationsProcessed: 12,
        extracted: 2,
        patterns: [{ private: "pattern" }],
      })),
      exportInstincts: vi.fn(() => ({
        version: "private-version",
        exportedAt: "private-path-or-time",
        count: 1,
        instincts: [instinct()],
      })),
      importInstincts: vi.fn(() => ({
        success: true,
        imported: 1,
        skipped: 0,
        records: [instinct()],
      })),
      getStats: vi.fn(() => ({
        totalInstincts: 3,
        byCategory: { testing: 2, privateCategory: 999 },
        avgConfidence: 0.75,
        highConfidenceCount: 2,
        totalObservations: 8,
        unprocessedObservations: 1,
        bufferSize: 2,
        totalUseCount: 9,
        privateMetric: "secret",
      })),
    };
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(manager, {
      ipcMain,
      coreAuthorization: { authorize: vi.fn(async () => true) },
      privacy: privacy(),
    });

    await expect(handlers.get("instinct:evolve")({})).resolves.toEqual({
      success: true,
      observationsProcessed: 12,
      extracted: 2,
    });
    const exported = await handlers.get("instinct:export")({});
    expect(exported).toEqual({
      success: true,
      data: {
        version: "1.0.0",
        count: 1,
        truncated: false,
        instincts: [
          expect.objectContaining({
            id: "instinct-1",
            examples: ["Run the smallest relevant suite"],
          }),
        ],
      },
    });
    expect(JSON.stringify(exported)).not.toContain("private-path-or-time");

    await expect(
      handlers.get("instinct:import")({}, exported.data),
    ).resolves.toEqual({ success: true, imported: 1, skipped: 0 });
    expect(manager.importInstincts).toHaveBeenCalledWith({
      instincts: [
        {
          pattern: "Prefer focused regression tests",
          confidence: 0.8,
          category: "testing",
          examples: ["Run the smallest relevant suite"],
        },
      ],
    });

    const stats = await handlers.get("instinct:get-stats")({});
    expect(stats.data).toEqual(
      expect.objectContaining({
        totalInstincts: 3,
        byCategory: { testing: 2 },
        avgConfidence: 0.75,
      }),
    );
    expect(JSON.stringify(stats)).not.toContain("private");
  });

  it("rejects hostile input without invoking accessors or manager methods", async () => {
    const getter = vi.fn(() => "private-pattern");
    const accessor = {};
    Object.defineProperty(accessor, "pattern", {
      enumerable: true,
      get: getter,
    });
    const exampleGetter = vi.fn(() => "private-example");
    const accessorExamples = [];
    Object.defineProperty(accessorExamples, 0, {
      enumerable: true,
      get: exampleGetter,
    });
    accessorExamples.length = 1;
    const projectedAccessor = instinct();
    Object.defineProperty(projectedAccessor, "pattern", {
      enumerable: true,
      get: getter,
    });
    const manager = {
      addInstinct: vi.fn(),
      getAll: vi.fn(() => [projectedAccessor]),
    };
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(manager, {
      ipcMain,
      coreAuthorization: { authorize: vi.fn(async () => true) },
      privacy: privacy(),
    });

    for (const input of [
      accessor,
      new Proxy({}, {}),
      { pattern: "valid", userId: "did:key:forged" },
      { pattern: "valid", examples: accessorExamples },
    ]) {
      await expect(handlers.get("instinct:add")({}, input)).resolves.toEqual({
        success: false,
        error: "Instinct operation failed",
        code: "CC_LLM_INSTINCT_OPERATION_FAILED",
      });
    }
    await expect(
      handlers.get("instinct:get-all")({}, { orderBy: "pattern; DROP TABLE" }),
    ).resolves.toMatchObject({ code: "CC_LLM_INSTINCT_OPERATION_FAILED" });
    await expect(handlers.get("instinct:get-all")({}, {})).resolves.toEqual({
      success: true,
      data: [],
    });
    expect(getter).not.toHaveBeenCalled();
    expect(exampleGetter).not.toHaveBeenCalled();
    expect(manager.addInstinct).not.toHaveBeenCalled();
    expect(manager.getAll).toHaveBeenCalledTimes(1);
  });

  it("uses fixed unavailable and manager failure results", async () => {
    const { handlers, ipcMain } = captureHandlers();
    registerInstinctIPC(null, {
      ipcMain,
      coreAuthorization: { authorize: vi.fn(async () => true) },
      privacy: privacy(),
    });
    await expect(handlers.get("instinct:get-stats")({})).resolves.toEqual({
      success: false,
      error: "Instinct service unavailable",
      code: "CC_LLM_INSTINCT_UNAVAILABLE",
    });

    const second = captureHandlers();
    registerInstinctIPC(
      {
        getStats() {
          throw new Error("private-database-path");
        },
      },
      {
        ipcMain: second.ipcMain,
        coreAuthorization: { authorize: vi.fn(async () => true) },
        privacy: privacy(),
      },
    );
    const result = await second.handlers.get("instinct:get-stats")({});
    expect(result).toEqual({
      success: false,
      error: "Instinct operation failed",
      code: "CC_LLM_INSTINCT_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("private-database-path");
  });
});
