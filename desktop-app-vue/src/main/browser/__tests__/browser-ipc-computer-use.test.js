import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { registerComputerUseHandlers } = require("../browser-ipc-computer-use");
const {
  createDesktopBrowserVisionObservationHost,
} = require("../../evolution/desktop-browser-vision-observation");

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function createObservationHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-observation",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
  });
  return createDesktopBrowserVisionObservationHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({
      descriptor,
      authorizeObservation: async (request) =>
        Object.freeze({
          schema: "chainlesschain.browser-vision-observation-receipt/v1",
          authorityId: descriptor.authorityId,
          tenantId: descriptor.tenantId,
          handlerArtifactDigest: descriptor.handlerArtifactDigest,
          requestId: request.requestId,
          targetId: request.targetId,
          operation: request.operation,
          senderId: request.senderId,
          frameUrlDigest: request.frameUrlDigest,
          inputDigest: request.inputDigest,
          validUntil: new Date(Date.now() + 10_000).toISOString(),
          receiptDigest: digest(request.requestId),
        }),
    });
  });
}

function fixture({ observationHost = null, actionHost = null } = {}) {
  const handlers = new Map();
  const getBrowserEngine = vi.fn();
  registerComputerUseHandlers({
    _ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    },
    _getBrowserEngine: getBrowserEngine,
    _getGovernedVisionModelClient: vi.fn(() => null),
    _getBrowserVisionObservationHost: vi.fn(() => observationHost),
    _getBrowserVisionActionHost: vi.fn(() => actionHost),
    withErrorHandler: (handler) => handler,
  });
  return { handlers, getBrowserEngine };
}

describe("browser computer-use IPC", () => {
  it("denies screenshot reads before browser-engine access without an observation host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    const handler = handlers.get("browser:action:vision");

    await expect(
      handler(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        { task: "analyze", prompt: "inspect" },
      ),
    ).rejects.toThrow(/branded Desktop browser vision observation host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("denies visual clicks before browser-engine access without an interactive action host", async () => {
    const { handlers, getBrowserEngine } = fixture({
      observationHost: createObservationHost(),
    });
    const handler = handlers.get("browser:visualClick");

    await expect(
      handler(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "submit button",
        {},
      ),
    ).rejects.toThrow(/branded Desktop browser vision action host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("denies visual typing before browser-engine access without an interactive action host", async () => {
    const { handlers, getBrowserEngine } = fixture({
      observationHost: createObservationHost(),
    });
    const handler = handlers.get("browser:visualType");

    await expect(
      handler(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "email input",
        "private@example.test",
        {},
      ),
    ).rejects.toThrow(/branded Desktop browser vision action host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });
});
