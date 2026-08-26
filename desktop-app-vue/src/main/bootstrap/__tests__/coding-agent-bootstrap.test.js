import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

const { createCodingAgentBootstrap } = require("../coding-agent-bootstrap.js");

class MockWindow extends EventEmitter {}

function createService() {
  return {
    setMainWindow: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Coding Agent V3 production bootstrap", () => {
  it("binds one service to the real IPC surface and the current window", () => {
    const service = createService();
    const unregister = vi.fn();
    const registerIPC = vi.fn(() => unregister);
    const mainWindow = new MockWindow();
    const controller = createCodingAgentBootstrap({
      service,
      registerIPC,
    });

    expect(controller.attachWindow(mainWindow)).toBe(service);
    expect(service.setMainWindow).toHaveBeenCalledWith(mainWindow);
    expect(registerIPC).toHaveBeenCalledWith({
      service,
      ipcMain: undefined,
      appServerPilot: null,
    });

    mainWindow.emit("closed");
    expect(service.setMainWindow).toHaveBeenLastCalledWith(null);
  });

  it("rebinds handlers without duplicating the service and shuts down once", async () => {
    const service = createService();
    const firstUnregister = vi.fn();
    const secondUnregister = vi.fn();
    const registerIPC = vi
      .fn()
      .mockReturnValueOnce(firstUnregister)
      .mockReturnValueOnce(secondUnregister);
    const controller = createCodingAgentBootstrap({
      service,
      registerIPC,
    });

    controller.attachWindow(new MockWindow());
    controller.attachWindow(new MockWindow());

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    expect(registerIPC).toHaveBeenCalledTimes(2);

    await controller.dispose();
    await controller.dispose();

    expect(secondUnregister).toHaveBeenCalledTimes(1);
    expect(service.shutdown).toHaveBeenCalledTimes(1);
    expect(controller.isDisposed()).toBe(true);
  });

  it("constructs and disposes the shared App Server pilot only behind the flag", async () => {
    const service = {
      ...createService(),
      repoRoot: "C:/repo",
      bridge: { cliEntry: "C:/repo/packages/cli/bin/chainlesschain.js" },
    };
    const pilot = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const PilotClass = vi.fn(function AppServerPilotMock() {
      return pilot;
    });
    const registerIPC = vi.fn(() => vi.fn());
    const controller = createCodingAgentBootstrap({
      service,
      registerIPC,
      appServerPilotEnabled: true,
      PilotClass,
    });

    controller.attachWindow(new MockWindow());
    expect(PilotClass).toHaveBeenCalledWith(
      expect.objectContaining({
        cliPath: "C:/repo/packages/cli/bin/chainlesschain.js",
        cwd: "C:/repo",
      }),
    );
    expect(registerIPC).toHaveBeenCalledWith({
      service,
      ipcMain: undefined,
      appServerPilot: pilot,
    });

    await controller.dispose();
    expect(pilot.close).toHaveBeenCalledOnce();
  });
});
