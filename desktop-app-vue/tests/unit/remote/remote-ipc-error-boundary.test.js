import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcHandlers = new Map();
const ipcMainMock = {
  handle: vi.fn((channel, handler) => ipcHandlers.set(channel, handler)),
  removeHandler: vi.fn(),
};

const originalLoad = Module._load;
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === "electron") {
    return { ipcMain: ipcMainMock };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  registerRemoteIPCHandlers,
} = require("../../../src/main/remote/remote-ipc");
Module._load = originalLoad;

describe("remote IPC error boundary", () => {
  beforeEach(() => {
    ipcHandlers.clear();
    vi.clearAllMocks();
  });

  it("does not disclose a synchronous gateway error", async () => {
    const secret = "connected-device-secret";
    registerRemoteIPCHandlers({
      getConnectedDevices() {
        throw new Error(secret);
      },
    });

    const result = await ipcHandlers.get("remote:get-connected-devices")();

    expect(result).toEqual({
      success: false,
      error: "Remote IPC operation failed",
      code: "REMOTE_IPC_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not disclose an asynchronous command error", async () => {
    const secret = "command-provider-secret";
    registerRemoteIPCHandlers({
      sendCommand: vi.fn().mockRejectedValue(new Error(secret)),
    });

    const result = await ipcHandlers.get("remote:send-command")(null, {
      peerId: "peer-1",
      method: "system.info",
      params: {},
    });

    expect(result).toEqual({
      success: false,
      error: "Remote IPC operation failed",
      code: "REMOTE_IPC_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("forbids dynamic caught error messages in failure payloads", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/remote/remote-ipc.js"),
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:error|message)\s*:\s*(?:error|err|e)\.message/u,
    );
  });
});
