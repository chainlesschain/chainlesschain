import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  OPERATION_PURPOSES,
  createAIEngineIpcAuthorization,
} = require("../../../src/main/ai-engine/ai-engine-ipc-authorization.js");

function desktopEvent(url = "http://localhost:5173/#/projects") {
  const mainFrame = { parent: null, url };
  const webContents = { id: 23, mainFrame };
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    mainWindow: { webContents },
  };
}

describe("AI Engine IPC authorization", () => {
  it("binds the trusted main frame to current identity and fixed purpose", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => ({ authorized: true }));
    const authorization = createAIEngineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({
        did: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      authorizePurpose,
    });

    const result = await authorization.authorize(event, "generate-ppt");

    expect(result).toEqual({
      actorDid: "did:key:operator",
      operation: "generate-ppt",
      purpose: "project-presentation-generate",
      senderId: 23,
      tenantId: "tenant:alpha",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(authorizePurpose).toHaveBeenCalledWith(result);
  });

  it("uses the authenticated DID as the personal tenant namespace", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorization = createAIEngineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:personal" }),
    });

    await expect(
      authorization.authorize(event, "generate-word"),
    ).resolves.toMatchObject({
      actorDid: "did:key:personal",
      purpose: "project-document-generate",
      tenantId: "did:key:personal",
    });
  });

  it.each([
    ["foreign origin", "https://example.com/projects", "generate-ppt"],
    ["unknown purpose", "http://localhost:5173", "private-operation"],
  ])("rejects %s", async (_label, url, operation) => {
    const { event, mainWindow } = desktopEvent(url);
    const authorization = createAIEngineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
    });

    await expect(
      authorization.authorize(event, operation),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });
  });

  it("rejects a secondary window, missing identity, and proxy identity", async () => {
    const primary = desktopEvent();
    const secondary = desktopEvent();
    const getCurrentIdentity = vi.fn(() => ({ did: "did:key:operator" }));
    const authorization = createAIEngineIpcAuthorization({
      getMainWindow: () => primary.mainWindow,
      getCurrentIdentity,
    });

    await expect(
      authorization.authorize(secondary.event, "generate-ppt"),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });

    getCurrentIdentity.mockReturnValue(null);
    await expect(
      authorization.authorize(primary.event, "generate-ppt"),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });

    getCurrentIdentity.mockReturnValue(new Proxy({ did: "did:key:x" }, {}));
    await expect(
      authorization.authorize(primary.event, "generate-ppt"),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });
  });

  it("fails closed when the purpose authority refuses or throws", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => false);
    const authorization = createAIEngineIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
      authorizePurpose,
    });

    await expect(
      authorization.authorize(event, "generate-word"),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });

    authorizePurpose.mockRejectedValueOnce(new Error("private policy error"));
    await expect(
      authorization.authorize(event, "generate-word"),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_IPC_UNAUTHORIZED" });
  });

  it("defines a purpose for every registered operation", () => {
    expect(OPERATION_PURPOSES).toEqual({
      "generate-ppt": "project-presentation-generate",
      "generate-word": "project-document-generate",
    });
  });
});
