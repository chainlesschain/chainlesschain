import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { registerComputerUseHandlers } = require("../browser-ipc-computer-use");
const {
  createDesktopBrowserVisionObservationHost,
} = require("../../evolution/desktop-browser-vision-observation");
const {
  createDesktopBrowserNavigationActionHost,
} = require("../../evolution/desktop-browser-navigation-action");

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const domainDigest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;

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

function createNavigationHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-navigation",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("navigation-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-navigation-action-receipt/v2",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      requestId: request.requestId,
      targetId: request.targetId,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      destinationDigest: domainDigest(
        "chainlesschain.browser-navigation-action-destination/v1",
        request.destinationUrl,
      ),
      redirectOriginsDigest: domainDigest(
        "chainlesschain.browser-navigation-action-redirect-origins/v1",
        request.allowedRedirectOrigins,
      ),
      waitUntil: request.waitUntil,
      timeout: request.timeout,
      inputDigest: request.inputDigest,
      requestDigest: digest(`request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest(request.requestId),
    }),
  );
  const recordActionOutcome = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-navigation-action-outcome-ack/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      actionReceiptDigest: request.actionReceiptDigest,
      outcomeRequestDigest: domainDigest(request.schema, request),
      auditEventDigest: digest(`audit:${request.resultDigest}`),
      durabilityReceiptDigest: digest(`durable:${request.resultDigest}`),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      qualifiesForPromotion: false,
    }),
  );
  const host = createDesktopBrowserNavigationActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

function fixture({
  observationHost = null,
  actionHost = null,
  navigationHost = null,
  engine = null,
} = {}) {
  const handlers = new Map();
  const getBrowserEngine = vi.fn(() => engine);
  registerComputerUseHandlers({
    _ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    },
    _getBrowserEngine: getBrowserEngine,
    _getGovernedVisionModelClient: vi.fn(() => null),
    _getBrowserVisionObservationHost: vi.fn(() => observationHost),
    _getBrowserVisionActionHost: vi.fn(() => actionHost),
    _getBrowserNavigationActionHost: vi.fn(() => navigationHost),
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

  it("denies Agent navigation before browser-engine access without its action host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    const handler = handlers.get("browser:action:navigate");

    await expect(
      handler(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "https://example.test/",
        {},
      ),
    ).rejects.toThrow(/branded Desktop browser navigation action host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("consumes one Agent navigation grant and records a redacted outcome", async () => {
    const destinationUrl = "https://example.test/path?private=value";
    const navigation = createNavigationHost();
    const engine = {
      navigate: vi.fn(async () => ({
        success: true,
        url: destinationUrl,
        title: "Example",
      })),
    };
    const { handlers, getBrowserEngine } = fixture({
      navigationHost: navigation.host,
      engine,
    });
    const handler = handlers.get("browser:action:navigate");

    await expect(
      handler(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        destinationUrl,
        { waitUntil: "networkidle", actionAuthorization: { approval: true } },
      ),
    ).resolves.toMatchObject({
      success: true,
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(navigation.authorizeAction).toHaveBeenCalledBefore(getBrowserEngine);
    expect(engine.navigate).toHaveBeenCalledWith("tab-1", destinationUrl, {
      waitUntil: "networkidle",
      allowedRedirectOrigins: ["https://example.test"],
    });
    expect(
      JSON.stringify(navigation.recordActionOutcome.mock.calls),
    ).not.toContain(destinationUrl);
  });

  it("durably records a failed Agent navigation before returning failure", async () => {
    const destinationUrl = "https://example.test/failure";
    const navigation = createNavigationHost();
    const engine = {
      navigate: vi.fn(async () => {
        throw new Error("page closed");
      }),
    };
    const { handlers } = fixture({
      navigationHost: navigation.host,
      engine,
    });

    await expect(
      handlers.get("browser:action:navigate")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        destinationUrl,
        {},
      ),
    ).resolves.toMatchObject({
      success: false,
      error: "Navigation failed: page closed",
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(navigation.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(
      JSON.stringify(navigation.recordActionOutcome.mock.calls),
    ).not.toContain(destinationUrl);
  });
});
