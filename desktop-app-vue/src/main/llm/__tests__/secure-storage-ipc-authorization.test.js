import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  OPERATION_PURPOSES,
  createSecureStorageIpcAuthorization,
} = require("../secure-storage-ipc-authorization");

function desktopEvent(url = "http://localhost:5173/#/settings") {
  const mainFrame = { parent: null, url };
  const webContents = { id: 19, mainFrame };
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    mainWindow: { webContents },
  };
}

describe("secure storage IPC authorization", () => {
  it("binds the trusted main frame to the current tenant and fixed purpose", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => true);
    const authorization = createSecureStorageIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({
        did: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      authorizePurpose,
    });

    const result = await authorization.authorize(event, "set-api-key");

    expect(result).toEqual({
      actorDid: "did:key:operator",
      operation: "set-api-key",
      purpose: "secret-configuration-write",
      senderId: 19,
      tenantId: "tenant:alpha",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(authorizePurpose).toHaveBeenCalledWith(result);
  });

  it("uses the authenticated DID as the personal tenant namespace", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorization = createSecureStorageIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:personal" }),
    });

    await expect(authorization.authorize(event, "load")).resolves.toMatchObject(
      {
        actorDid: "did:key:personal",
        purpose: "secret-configuration-status-read",
        tenantId: "did:key:personal",
      },
    );
  });

  it.each([
    ["foreign origin", "https://example.com/settings", "load"],
    ["unknown purpose", "http://localhost:5173", "private-operation"],
  ])("rejects %s", async (_label, url, operation) => {
    const { event, mainWindow } = desktopEvent(url);
    const authorization = createSecureStorageIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
    });

    await expect(
      authorization.authorize(event, operation),
    ).rejects.toMatchObject({ code: "CC_SECURE_STORAGE_UNAUTHORIZED" });
  });

  it("rejects a trusted secondary window and a missing identity", async () => {
    const primary = desktopEvent();
    const secondary = desktopEvent();
    const getCurrentIdentity = vi.fn(() => ({ did: "did:key:operator" }));
    const authorization = createSecureStorageIpcAuthorization({
      getMainWindow: () => primary.mainWindow,
      getCurrentIdentity,
    });

    await expect(
      authorization.authorize(secondary.event, "export"),
    ).rejects.toMatchObject({ code: "CC_SECURE_STORAGE_UNAUTHORIZED" });

    getCurrentIdentity.mockReturnValue(null);
    await expect(
      authorization.authorize(primary.event, "export"),
    ).rejects.toMatchObject({ code: "CC_SECURE_STORAGE_UNAUTHORIZED" });
  });

  it("fails closed when the purpose authority refuses or throws", async () => {
    const { event, mainWindow } = desktopEvent();
    const authorizePurpose = vi.fn(async () => false);
    const authorization = createSecureStorageIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({ did: "did:key:operator" }),
      authorizePurpose,
    });

    await expect(
      authorization.authorize(event, "delete"),
    ).rejects.toMatchObject({ code: "CC_SECURE_STORAGE_UNAUTHORIZED" });

    authorizePurpose.mockRejectedValueOnce(new Error("private policy error"));
    await expect(
      authorization.authorize(event, "delete"),
    ).rejects.toMatchObject({ code: "CC_SECURE_STORAGE_UNAUTHORIZED" });
  });

  it("defines a purpose for every registered secure storage operation", () => {
    expect(Object.keys(OPERATION_PURPOSES).sort()).toEqual(
      [
        "batch-set-api-keys",
        "clear-cache",
        "create-backup",
        "delete",
        "delete-api-key",
        "exists",
        "export",
        "get-api-key-masked",
        "get-configured-providers",
        "get-info",
        "get-provider-fields",
        "get-sensitive-fields",
        "has-api-key",
        "import",
        "is-sensitive",
        "list-backups",
        "load",
        "migrate-to-safe-storage",
        "restore-backup",
        "sanitize",
        "save",
        "set-api-key",
        "validate-api-key",
      ].sort(),
    );
  });
});
