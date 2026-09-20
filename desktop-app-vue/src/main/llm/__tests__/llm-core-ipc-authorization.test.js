import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  OPERATION_AUTHORIZATION,
  createLlmCoreIpcAuthorization,
} = require("../llm-core-ipc-authorization");
const { registerCoreHandlers } = require("../llm-ipc-core");

function sender(url = "http://localhost:5173/") {
  const mainFrame = { parent: null, url };
  const webContents = { id: 73, mainFrame };
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    mainWindow: { webContents },
  };
}

describe("LLM core IPC authorization", () => {
  it("binds the main renderer, current DID tenant, purpose, and output fields", async () => {
    const { event, mainWindow } = sender();
    const authorizePurpose = vi.fn(async () => true);
    const authorization = createLlmCoreIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({
        did: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      authorizePurpose,
    });

    const result = await authorization.authorize(event, "chat");

    expect(result).toEqual({
      actorDid: "did:key:operator",
      fields: [
        "model-response",
        "usage",
        "retrieval-metadata",
        "optimization-receipt",
      ],
      operation: "chat",
      purpose: "model-inference",
      senderId: 73,
      tenantId: "tenant:alpha",
    });
    expect(authorizePurpose).toHaveBeenCalledWith(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.fields)).toBe(true);
  });

  it("uses the authenticated DID as the personal tenant", async () => {
    const { event, mainWindow } = sender();
    const authorization = createLlmCoreIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:personal" }),
    });

    await expect(authorization.authorize(event, "embeddings")).resolves.toEqual(
      expect.objectContaining({
        actorDid: "did:key:personal",
        fields: ["embedding-vector", "usage"],
        purpose: "model-embedding",
        tenantId: "did:key:personal",
      }),
    );
  });

  it("rejects secondary windows, subframes, and foreign origins", async () => {
    const primary = sender();
    const secondary = sender();
    const authorization = createLlmCoreIpcAuthorization({
      getMainWindow: () => primary.mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
    });
    const subframe = {
      sender: primary.event.sender,
      senderFrame: {
        parent: primary.event.senderFrame,
        url: "http://localhost:5173/frame",
      },
    };
    const foreignFrame = {
      parent: null,
      url: "https://foreign.example.test/",
    };
    const foreign = {
      sender: { id: 73, mainFrame: foreignFrame },
      senderFrame: foreignFrame,
    };

    for (const event of [secondary.event, subframe, foreign]) {
      await expect(
        authorization.authorize(event, "query"),
      ).rejects.toMatchObject({ code: "CC_LLM_IPC_UNAUTHORIZED" });
    }
  });

  it("rejects missing identities, unknown operations, and policy refusal", async () => {
    const { event, mainWindow } = sender();
    const getCurrentIdentity = vi.fn(() => null);
    const authorizePurpose = vi.fn(async () => false);
    const authorization = createLlmCoreIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity,
      authorizePurpose,
    });

    await expect(authorization.authorize(event, "query")).rejects.toMatchObject(
      {
        code: "CC_LLM_IPC_UNAUTHORIZED",
      },
    );
    getCurrentIdentity.mockReturnValue({ did: "did:key:operator" });
    await expect(
      authorization.authorize(event, "unknown"),
    ).rejects.toMatchObject({ code: "CC_LLM_IPC_UNAUTHORIZED" });
    await expect(authorization.authorize(event, "query")).rejects.toMatchObject(
      {
        code: "CC_LLM_IPC_UNAUTHORIZED",
      },
    );
    authorizePurpose.mockRejectedValueOnce(new Error("private policy error"));
    await expect(authorization.authorize(event, "query")).rejects.toMatchObject(
      {
        code: "CC_LLM_IPC_UNAUTHORIZED",
      },
    );
  });

  it("defines authorization scopes for every governed LLM operation", () => {
    expect(Object.keys(OPERATION_AUTHORIZATION).sort()).toEqual(
      [
        "add-alert",
        "calculate-cost-estimate",
        "can-perform-operation",
        "chat",
        "chat-with-template",
        "check-status",
        "cleanup-old-data",
        "clear-test-data",
        "clear-context",
        "clear-alert-history",
        "clear-cache",
        "create-stream-controller",
        "delete-model-budget",
        "dismiss-alert",
        "destroy-stream-controller",
        "embeddings",
        "export-cost-report",
        "generate-test-data",
        "generate-report",
        "get-config",
        "get-alert-history",
        "get-budget",
        "get-cache-stats",
        "get-cost-breakdown",
        "get-model-budgets",
        "get-retention-config",
        "get-selector-info",
        "get-stream-stats",
        "get-time-series",
        "get-usage-stats",
        "instinct-add",
        "instinct-decay",
        "instinct-delete",
        "instinct-evolve",
        "instinct-export",
        "instinct-get-all",
        "instinct-get-relevant",
        "instinct-get-stats",
        "instinct-import",
        "instinct-reinforce",
        "instinct-update",
        "list-models",
        "query",
        "query-stream",
        "pause-stream",
        "pause-service",
        "resume-stream",
        "resume-service",
        "response-cache-check",
        "response-cache-clear-all",
        "response-cache-clear-expired",
        "response-cache-get-config",
        "response-cache-get-hit-rate-trend",
        "response-cache-get-stats",
        "response-cache-get-stats-by-provider",
        "response-cache-set-config",
        "response-cache-start-auto-cleanup",
        "response-cache-stop-auto-cleanup",
        "response-cache-warmup-status",
        "select-best",
        "set-config",
        "set-model-budget",
        "set-budget",
        "set-retention-config",
        "stream-cancel",
        "stream-clear-buffer",
        "stream-complete",
        "stream-create",
        "stream-destroy",
        "stream-get-buffer",
        "stream-get-stats",
        "stream-get-status",
        "stream-list-active",
        "stream-pause",
        "stream-resume",
        "stream-start",
        "cancel-stream",
        "switch-provider",
      ].sort(),
    );
    expect(OPERATION_AUTHORIZATION["generate-test-data"]).toEqual({
      purpose: "model-test-data-generate",
      fields: ["usage-test-data"],
    });
    expect(OPERATION_AUTHORIZATION["clear-test-data"]).toEqual({
      purpose: "model-test-data-delete",
      fields: ["usage-test-data"],
    });
    expect(OPERATION_AUTHORIZATION["instinct-export"]).toEqual({
      purpose: "model-instinct-export",
      fields: ["instinct-export"],
    });
    expect(OPERATION_AUTHORIZATION["response-cache-clear-all"]).toEqual({
      purpose: "model-cache-delete",
      fields: ["cache-control-receipt"],
    });
  });

  it("fails closed before invoking the manager", async () => {
    const handlers = new Map();
    const manager = { query: vi.fn() };
    registerCoreHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      managerRef: { current: manager },
      coreAuthorization: {
        authorize: vi.fn(async () => {
          throw new Error("private authorization reason");
        }),
      },
    });

    await expect(
      handlers.get("llm:query")({}, "private prompt", {}),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "core",
      operation: "query",
    });
    expect(manager.query).not.toHaveBeenCalled();
  });
});
