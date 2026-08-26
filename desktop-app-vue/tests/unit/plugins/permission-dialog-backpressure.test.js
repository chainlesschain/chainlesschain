import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
}));

const {
  PermissionDialogManager,
} = require("../../../src/main/plugins/permission-dialog-manager.js");

describe("PermissionDialogManager backpressure", () => {
  it("bounds pending permission prompts and clears completed work", async () => {
    const manager = new PermissionDialogManager({
      maxPendingRequests: 1,
      requestTimeoutMs: 60_000,
    });
    manager.setMainWindow({
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    });
    const manifest = { id: "plugin", permissions: ["network"] };

    const first = manager.requestPermissions(manifest);
    await expect(manager.requestPermissions(manifest)).rejects.toMatchObject({
      code: "OVERLOADED",
      retryAfterMs: 100,
    });

    const requestId = [...manager.pendingRequests.keys()][0];
    manager.handlePermissionResponse(requestId, { granted: false });
    await expect(first).resolves.toMatchObject({ granted: false });
    expect(manager.pendingRequests.size).toBe(0);
  });
});
