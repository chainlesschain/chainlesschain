"use strict";

const { normalizeLogEntry, registerLoggerIPC } = require("../logger-ipc");

function createHarness({ authorizePurpose = vi.fn(() => true) } = {}) {
  const handlers = new Map();
  const mainFrame = { parent: null, url: "http://localhost:5173/" };
  const webContents = { id: 17, mainFrame };
  const mainWindow = { webContents };
  const child = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const logger = {
    child: vi.fn(() => child),
    info: vi.fn(),
    warn: vi.fn(),
  };
  registerLoggerIPC({
    authorizePurpose,
    getCurrentIdentity: () => ({
      did: "did:example:alice",
      tenantId: "team-a",
    }),
    getMainWindow: () => mainWindow,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    logger,
  });
  return {
    authorizePurpose,
    child,
    event: { sender: webContents, senderFrame: mainFrame },
    handlers,
    logger,
  };
}

function validEntry(overrides = {}) {
  return {
    data: { count: 2, password: "hidden" },
    level: "INFO",
    message: "renderer-ready",
    module: "bootstrap",
    stack: null,
    timestamp: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("authorized renderer logger IPC", () => {
  it("registers only the used write channel and binds it to actor purpose", async () => {
    const harness = createHarness();
    expect([...harness.handlers.keys()]).toEqual(["logger:write"]);

    await expect(
      harness.handlers.get("logger:write")(harness.event, validEntry()),
    ).resolves.toEqual({ success: true });
    expect(harness.authorizePurpose).toHaveBeenCalledWith({
      actorDid: "did:example:alice",
      fields: ["diagnostic-event"],
      operation: "logger-write",
      purpose: "renderer-diagnostic-write",
      senderId: 17,
      tenantId: "team-a",
    });
    expect(harness.logger.child).toHaveBeenCalledWith("bootstrap");
    expect(harness.child.info).toHaveBeenCalledWith("renderer-ready", {
      count: 2,
      password: "***REDACTED***",
    });
  });

  it("rejects a different window before writing diagnostics", async () => {
    const harness = createHarness();
    await expect(
      harness.handlers.get("logger:write")(
        { ...harness.event, sender: { id: 99 } },
        validEntry(),
      ),
    ).rejects.toMatchObject({ code: "CC_LOGGER_IPC_UNAUTHORIZED" });
    expect(harness.logger.child).not.toHaveBeenCalled();
  });

  it("fails closed on denied purpose authorization", async () => {
    const harness = createHarness({ authorizePurpose: vi.fn(() => false) });
    await expect(
      harness.handlers.get("logger:write")(harness.event, validEntry()),
    ).rejects.toMatchObject({ code: "CC_LOGGER_IPC_UNAUTHORIZED" });
    expect(harness.logger.child).not.toHaveBeenCalled();
  });

  it("rejects accessors, proxies, unknown fields, and oversized messages", async () => {
    const harness = createHarness();
    const accessor = validEntry();
    Object.defineProperty(accessor, "message", {
      enumerable: true,
      get: () => "secret",
    });
    const invalidEntries = [
      accessor,
      new Proxy(validEntry(), {}),
      { ...validEntry(), extra: true },
      validEntry({ message: "x".repeat(4097) }),
    ];
    for (const entry of invalidEntries) {
      await expect(
        harness.handlers.get("logger:write")(harness.event, entry),
      ).resolves.toMatchObject({
        code: "CC_LOGGER_IPC_WRITE_REJECTED",
        success: false,
      });
    }
    expect(harness.logger.child).not.toHaveBeenCalled();
  });

  it("normalizes nested plain data and rejects structural abuse", () => {
    expect(
      normalizeLogEntry(
        validEntry({ data: { apiKey: "secret", nested: [1, true] } }),
      ).data,
    ).toEqual({ apiKey: "***REDACTED***", nested: [1, true] });
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => normalizeLogEntry(validEntry({ data: cyclic }))).toThrow();
  });
});
