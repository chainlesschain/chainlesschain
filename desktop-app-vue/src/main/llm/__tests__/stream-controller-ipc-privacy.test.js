import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const {
  destroyAllStreamControllers,
  getActiveController,
  getActiveControllerCount,
  registerStreamControllerIPC,
} = require("../stream-controller-ipc");

function setup(authorization, streamPrivacy) {
  const handlers = new Map();
  const registered = new Set();
  const ipcGuard = {
    isModuleRegistered: (name) => registered.has(name),
    markModuleRegistered: (name) => registered.add(name),
    unmarkModuleRegistered: (name) => registered.delete(name),
  };
  registerStreamControllerIPC({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    },
    ipcGuard,
    coreAuthorization: authorization,
    streamPrivacy,
  });
  return handlers;
}

describe("legacy stream controller IPC privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroyAllStreamControllers();
  });

  afterEach(() => {
    destroyAllStreamControllers();
  });

  it("binds controllers to tenants and projects lifecycle results", async () => {
    const authorize = vi.fn(async (event) => ({ tenantId: event.tenantId }));
    const handlers = setup({ authorize });
    const tenantA = Object.freeze({ tenantId: "tenant:alpha" });
    const tenantB = Object.freeze({ tenantId: "tenant:beta" });
    const secret = "private-buffer-result-cancel-reason";

    const created = await handlers.get("stream:create")(tenantA, {
      enableBuffering: true,
      maxBufferedChunks: 4,
      maxBufferedBytes: 4096,
      maxBufferedChunkBytes: 1024,
      maxPauseWaiters: 2,
    });
    expect(created).toEqual({
      success: true,
      streamId: expect.stringMatching(/^stream:[0-9a-f-]{36}$/u),
    });
    expect(Object.isFrozen(created)).toBe(true);

    const controller = getActiveController(created.streamId);
    await expect(
      handlers.get("stream:start")(tenantA, created.streamId),
    ).resolves.toEqual({ success: true });
    await controller.processChunk({ content: secret });
    await expect(
      handlers.get("stream:pause")(tenantA, created.streamId),
    ).resolves.toEqual({ success: true });
    await expect(
      handlers.get("stream:resume")(tenantA, created.streamId),
    ).resolves.toEqual({ success: true });

    const status = await handlers.get("stream:get-status")(
      tenantA,
      created.streamId,
    );
    expect(status).toEqual({
      success: true,
      status: "running",
      isPaused: false,
      processedChunks: 1,
      totalChunks: 1,
    });
    const buffer = await handlers.get("stream:get-buffer")(
      tenantA,
      created.streamId,
    );
    expect(buffer).toEqual({
      success: true,
      bufferedChunks: 1,
      bufferedBytes: expect.any(Number),
    });
    expect(JSON.stringify({ status, buffer })).not.toContain(secret);

    await expect(
      handlers.get("stream:list-active")(tenantB),
    ).resolves.toEqual({ success: true, count: 0, streams: [] });
    await expect(
      handlers.get("stream:get-status")(tenantB, created.streamId),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      component: "stream",
      operation: "stream-get-status",
    });
    await expect(
      handlers.get("stream:destroy")(tenantB, created.streamId),
    ).resolves.toEqual({ success: true });
    expect(getActiveController(created.streamId)).toBe(controller);

    await expect(
      handlers.get("stream:cancel")(tenantA, created.streamId, secret),
    ).resolves.toEqual({ success: true });
    expect(controller.signal.reason).toBe("LLM stream cancelled");
    await expect(
      handlers.get("stream:destroy")(tenantA, created.streamId),
    ).resolves.toEqual({ success: true });
    expect(getActiveController(created.streamId)).toBeUndefined();
  });

  it("removes completion results and buffer content from receipts", async () => {
    const handlers = setup({
      authorize: vi.fn(async () => ({ tenantId: "tenant:alpha" })),
    });
    const event = {};
    const secret = "private-completion-and-buffer-content";
    const created = await handlers.get("stream:create")(event, {
      enableBuffering: true,
    });
    const controller = getActiveController(created.streamId);
    await handlers.get("stream:start")(event, created.streamId);
    await controller.processChunk(secret);

    const stats = await handlers.get("stream:get-stats")(
      event,
      created.streamId,
    );
    const completed = await handlers.get("stream:complete")(
      event,
      created.streamId,
      { result: secret },
    );
    expect(completed).toEqual({ success: true });
    expect(stats.stats).not.toHaveProperty("startTime");
    expect(stats.stats).not.toHaveProperty("endTime");
    expect(stats.stats).not.toHaveProperty("bufferLimits");
    expect(JSON.stringify({ stats, completed })).not.toContain(secret);
  });

  it("rejects unauthorized, custom-id, hostile and oversized requests early", async () => {
    const secret = "private-stream-id-and-error";
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const privacy = createLlmIpcPrivacy("stream", sink);
    const deniedHandlers = setup({
      authorize: vi.fn(async () => {
        throw new Error(secret);
      }),
    }, privacy);
    await expect(
      deniedHandlers.get("stream:create")({}, {}),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "stream",
      operation: "stream-create",
    });
    expect(getActiveControllerCount()).toBe(0);

    const handlers = setup(
      {
        authorize: vi.fn(async () => ({ tenantId: "tenant:alpha" })),
      },
      privacy,
    );
    for (const options of [
      { streamId: secret },
      { maxBufferedChunks: Number.MAX_SAFE_INTEGER },
      Object.defineProperty({}, "enableBuffering", { get: () => true }),
      new Proxy({}, { ownKeys: () => [secret] }),
    ]) {
      await expect(handlers.get("stream:create")({}, options)).rejects.toMatchObject(
        {
          code: "CC_LLM_IPC_OPERATION_FAILED",
          component: "stream",
          operation: "stream-create",
        },
      );
    }
    expect(getActiveControllerCount()).toBe(0);
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("keeps raw logging and error access out of the IPC source", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "stream-controller-ipc.js"),
      "utf8",
    );
    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
    expect(source).not.toMatch(/\b(?:error|err)\.message\b/u);
    expect(source).not.toContain("getBuffer()");
  });
});
