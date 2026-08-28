import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const DeepLinkHandler = require("../deep-link-handler");

class FakeApp extends EventEmitter {
  constructor() {
    super();
    this.setAsDefaultProtocolClient = vi.fn(() => true);
  }
}

function createWindow() {
  return {
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    show: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DeepLinkHandler lifecycle", () => {
  it("registers one listener pair and treats repeated registration as a no-op", () => {
    const app = new FakeApp();
    const handler = new DeepLinkHandler(createWindow(), {});

    expect(handler.register(app)).toBe(true);
    expect(handler.register(app)).toBe(false);
    expect(app.listenerCount("open-url")).toBe(1);
    expect(app.listenerCount("second-instance")).toBe(1);
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
  });

  it("moves listener ownership when the Electron app instance changes", () => {
    const firstApp = new FakeApp();
    const secondApp = new FakeApp();
    const mainWindow = createWindow();
    const handler = new DeepLinkHandler(mainWindow, {});

    handler.register(firstApp);
    expect(handler.register(secondApp)).toBe(true);

    expect(firstApp.listenerCount("open-url")).toBe(0);
    expect(firstApp.listenerCount("second-instance")).toBe(0);
    expect(secondApp.listenerCount("open-url")).toBe(1);
    expect(secondApp.listenerCount("second-instance")).toBe(1);
    expect(handler.mainWindow).toBe(mainWindow);
  });

  it("routes app events through owned listeners", () => {
    const app = new FakeApp();
    const mainWindow = createWindow();
    mainWindow.isMinimized.mockReturnValue(true);
    const handler = new DeepLinkHandler(mainWindow, {});
    const handleDeepLink = vi
      .spyOn(handler, "handleDeepLink")
      .mockResolvedValue(undefined);
    const event = { preventDefault: vi.fn() };

    handler.register(app);
    app.emit("open-url", event, "chainlesschain://notes/one");
    app.emit("second-instance", {}, [
      "chainlesschain.exe",
      "chainlesschain://did/example",
    ]);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(handleDeepLink).toHaveBeenNthCalledWith(
      1,
      "chainlesschain://notes/one",
    );
    expect(handleDeepLink).toHaveBeenNthCalledWith(
      2,
      "chainlesschain://did/example",
    );
    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });

  it("owns one startup timer and cancels all work during idempotent destroy", async () => {
    vi.useFakeTimers();
    const app = new FakeApp();
    const handler = new DeepLinkHandler(createWindow(), {});
    const handleDeepLink = vi
      .spyOn(handler, "handleDeepLink")
      .mockResolvedValue(undefined);

    handler.register(app);
    handler.handleStartupUrl(["chainlesschain://notes/first"]);
    const firstTimer = handler.startupTimer;
    handler.handleStartupUrl(["chainlesschain://notes/latest"]);

    expect(handler.startupTimer).not.toBe(firstTimer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handleDeepLink).toHaveBeenCalledOnce();
    expect(handleDeepLink).toHaveBeenCalledWith(
      "chainlesschain://notes/latest",
    );
    expect(handler.startupTimer).toBeNull();

    handler.handleStartupUrl(["chainlesschain://notes/cancelled"]);
    handler.destroy();
    handler.destroy();
    await vi.runAllTimersAsync();

    expect(handleDeepLink).toHaveBeenCalledOnce();
    expect(app.listenerCount("open-url")).toBe(0);
    expect(app.listenerCount("second-instance")).toBe(0);
    expect(handler.mainWindow).toBeNull();
    expect(handler.organizationManager).toBeNull();
  });

  it("rejects registration without an Electron app event source", () => {
    const handler = new DeepLinkHandler(createWindow(), {});
    expect(() => handler.register(null)).toThrow(/Electron app is required/);
  });

  it("keeps main as the only owner across window recreation and shutdown", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    const socialInitializerSource = readFileSync(
      path.resolve(
        testDirectory,
        "..",
        "..",
        "bootstrap",
        "social-initializer.js",
      ),
      "utf8",
    );
    const recreationFence = mainSource.indexOf(
      "this.deepLinkHandler?.destroy();",
    );
    const ownedConstruction = mainSource.indexOf(
      "this.deepLinkHandler = new DeepLinkHandler(",
    );

    expect(recreationFence).toBeGreaterThan(-1);
    expect(ownedConstruction).toBeGreaterThan(recreationFence);
    expect(mainSource).toContain("this.deepLinkHandler.destroy();");
    expect(socialInitializerSource).not.toContain('name: "deepLinkHandler"');
  });
});
