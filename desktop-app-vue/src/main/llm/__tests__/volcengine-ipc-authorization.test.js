import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  OPERATION_PURPOSES,
  createVolcengineIpcAuthorization,
} = require("../volcengine-ipc-authorization");

function desktopEvent(url = "http://localhost:5173/#/settings") {
  const mainFrame = { parent: null, url };
  const webContents = { id: 17, mainFrame };
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    mainWindow: { webContents },
  };
}

describe("Volcengine IPC authorization", () => {
  it("binds the trusted main frame to the current tenant and fixed purpose", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => true);
    const authorization = createVolcengineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({
        did: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      authorizePurpose,
    });

    const result = await authorization.authorize(event, "select-model");

    expect(result).toEqual({
      actorDid: "did:key:operator",
      operation: "select-model",
      purpose: "model-selection",
      senderId: 17,
      tenantId: "tenant:alpha",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(authorizePurpose).toHaveBeenCalledWith(result);
  });

  it("uses the authenticated DID as the personal tenant namespace", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorization = createVolcengineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:personal" }),
    });

    await expect(
      authorization.authorize(event, "check-config"),
    ).resolves.toMatchObject({
      actorDid: "did:key:personal",
      purpose: "provider-configuration-read",
      tenantId: "did:key:personal",
    });
  });

  it.each([
    ["foreign origin", "https://example.com/settings", "select-model"],
    ["unknown purpose", "http://localhost:5173", "private-operation"],
  ])("rejects %s", async (_label, url, operation) => {
    const { event, mainWindow } = desktopEvent(url);
    const authorization = createVolcengineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
    });

    await expect(
      authorization.authorize(event, operation),
    ).rejects.toMatchObject({ code: "CC_VOLCENGINE_IPC_UNAUTHORIZED" });
  });

  it("rejects a trusted secondary window and a missing identity", async () => {
    const primary = desktopEvent();
    const secondary = desktopEvent();
    const getCurrentIdentity = vi.fn(() => ({ did: "did:key:operator" }));
    const authorization = createVolcengineIpcAuthorization({
      getMainWindow: () => primary.mainWindow,
      getCurrentIdentity,
    });

    await expect(
      authorization.authorize(secondary.event, "list-models"),
    ).rejects.toMatchObject({ code: "CC_VOLCENGINE_IPC_UNAUTHORIZED" });

    getCurrentIdentity.mockReturnValue(null);
    await expect(
      authorization.authorize(primary.event, "list-models"),
    ).rejects.toMatchObject({ code: "CC_VOLCENGINE_IPC_UNAUTHORIZED" });
  });

  it("fails closed when the purpose authority refuses or throws", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => false);
    const authorization = createVolcengineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
      authorizePurpose,
    });

    await expect(
      authorization.authorize(event, "update-config"),
    ).rejects.toMatchObject({ code: "CC_VOLCENGINE_IPC_UNAUTHORIZED" });

    authorizePurpose.mockRejectedValueOnce(new Error("private policy error"));
    await expect(
      authorization.authorize(event, "update-config"),
    ).rejects.toMatchObject({ code: "CC_VOLCENGINE_IPC_UNAUTHORIZED" });
  });

  it("defines a purpose for every registered Volcengine operation", () => {
    expect(Object.keys(OPERATION_PURPOSES).sort()).toEqual(
      [
        "chat-with-function-calling",
        "chat-with-image",
        "chat-with-knowledge-base",
        "chat-with-mcp",
        "chat-with-multiple-tools",
        "chat-with-web-search",
        "check-config",
        "estimate-cost",
        "execute-function-calling",
        "list-models",
        "select-model",
        "select-model-by-task",
        "setup-knowledge-base",
        "understand-image",
        "update-config",
      ].sort(),
    );
  });
});
