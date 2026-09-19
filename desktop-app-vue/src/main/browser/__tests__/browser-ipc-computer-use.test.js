import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { registerComputerUseHandlers } = require("../browser-ipc-computer-use");
const {
  createDesktopBrowserVisionObservationHost,
} = require("../../evolution/desktop-browser-vision-observation");
const {
  createDesktopBrowserNavigationActionHost,
} = require("../../evolution/desktop-browser-navigation-action");
const {
  createDesktopBrowserKeyboardActionHost,
} = require("../../evolution/desktop-browser-keyboard-action");
const {
  createDesktopBrowserTabOpenActionHost,
} = require("../../evolution/desktop-browser-tab-open-action");
const {
  createDesktopBrowserDownloadActionHost,
} = require("../../evolution/desktop-browser-download-action");
const {
  createDesktopBrowserDownloadArtifactDisposalHost,
} = require("../../evolution/desktop-browser-download-artifact-disposal");

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
      schema: "chainlesschain.browser-navigation-action-receipt/v3",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      requestId: request.requestId,
      targetId: request.targetId,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      destinationDigest:
        request.destinationUrl === null
          ? null
          : domainDigest(
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

function createKeyboardHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-keyboard",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("keyboard-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-keyboard-action-receipt/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      requestId: request.requestId,
      targetId: request.targetId,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      keyDigest: domainDigest("chainlesschain.browser-keyboard-action-key/v1", {
        key: request.key,
        modifiers: request.modifiers,
      }),
      delay: request.delay,
      inputDigest: request.inputDigest,
      requestDigest: digest(`request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest(request.requestId),
    }),
  );
  const recordActionOutcome = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-keyboard-action-outcome-ack/v1",
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
  const host = createDesktopBrowserKeyboardActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

function createTabOpenHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-tab-open",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("tab-open-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-tab-open-action-receipt/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      requestId: request.requestId,
      profileName: request.profileName,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      destinationDigest: domainDigest(
        "chainlesschain.browser-tab-open-action-destination/v1",
        request.destinationUrl,
      ),
      redirectOriginsDigest: domainDigest(
        "chainlesschain.browser-tab-open-action-redirect-origins/v1",
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
      schema: "chainlesschain.browser-tab-open-action-outcome-ack/v1",
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
  const host = createDesktopBrowserTabOpenActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

function createDownloadHost({
  failed = false,
  executePort = null,
  cancelPort = null,
} = {}) {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-download",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("download-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    artifactMode: "opaque-quarantine-clean-scan",
  });
  const authorizeAction = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-download-action-receipt/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      artifactMode: descriptor.artifactMode,
      requestId: request.requestId,
      targetId: request.targetId,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      destinationDigest: domainDigest(
        "chainlesschain.browser-download-action-destination/v1",
        request.destinationUrl,
      ),
      redirectOriginsDigest: domainDigest(
        "chainlesschain.browser-download-action-redirect-origins/v1",
        request.allowedRedirectOrigins,
      ),
      contentTypesDigest: domainDigest(
        "chainlesschain.browser-download-action-content-types/v1",
        request.allowedContentTypes,
      ),
      maxBytes: request.maxBytes,
      timeout: request.timeout,
      inputDigest: request.inputDigest,
      requestDigest: digest(`request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest(request.requestId),
    }),
  );
  const executeAuthorizedDownload =
    executePort ??
    vi.fn(async () =>
      Object.freeze(
        failed
          ? {
              status: "failed",
              failureClass: "download-provider-failed",
              artifactRef: null,
              artifactDigest: null,
              sizeBytes: null,
              contentType: null,
              finalUrlDigest: null,
              redirectOriginsDigest: null,
              scanEvidenceDigest: null,
              quarantineReceiptDigest: null,
              completionReceiptDigest: null,
              completedAt: null,
              resultDigest: digest("failed-result"),
            }
          : {
              status: "succeeded",
              failureClass: null,
              artifactRef: "quarantine:artifact-1",
              artifactDigest: digest("artifact"),
              sizeBytes: 4096,
              contentType: "application/pdf",
              finalUrlDigest: digest("final-url"),
              redirectOriginsDigest: digest("redirects"),
              scanEvidenceDigest: digest("scan"),
              quarantineReceiptDigest: digest("quarantine"),
              completionReceiptDigest: digest("completion"),
              completedAt: new Date().toISOString(),
              resultDigest: digest("success-result"),
            },
      ),
    );
  const cancelAuthorizedDownload =
    cancelPort ?? vi.fn(async () => ({ accepted: true }));
  const recordActionOutcome = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-download-action-outcome-ack/v1",
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
  const host = createDesktopBrowserDownloadActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({
      descriptor,
      authorizeAction,
      cancelAuthorizedDownload,
      executeAuthorizedDownload,
      recordActionOutcome,
    });
  });
  return {
    authorizeAction,
    cancelAuthorizedDownload,
    executeAuthorizedDownload,
    host,
    recordActionOutcome,
  };
}

function createDownloadDisposalHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "ipc-download-disposal",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("download-disposal-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
  });
  const authorizeDisposal = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-download-artifact-disposal-receipt/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      auditMode: descriptor.auditMode,
      effectMode: descriptor.effectMode,
      requestId: request.requestId,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      operation: request.operation,
      artifactRefDigest: domainDigest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ),
      artifactDigest: request.artifactDigest,
      sourceActionReceiptDigest: request.sourceActionReceiptDigest,
      reason: request.reason,
      inputDigest: request.inputDigest,
      requestDigest: digest(`request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest(request.requestId),
    }),
  );
  const disposeAuthorizedArtifact = vi.fn(async () => {
    const core = {
      status: "discarded",
      artifactRefDigest: domainDigest(
        "chainlesschain.browser-download-artifact-ref/v1",
        "quarantine:artifact-1",
      ),
      artifactDigest: digest("artifact"),
      sourceActionReceiptDigest: digest("download-receipt"),
      reason: "user-discard",
      discardedAt: new Date().toISOString(),
      deletionReceiptDigest: digest("deletion"),
    };
    return Object.freeze({
      ...core,
      resultDigest: domainDigest(
        "chainlesschain.browser-download-artifact-disposal-result/v1",
        core,
      ),
    });
  });
  const host = createDesktopBrowserDownloadArtifactDisposalHost(
    authority,
    (value) => {
      if (value !== authority) throw new TypeError("unbranded");
      return Object.freeze({
        descriptor,
        authorizeDisposal,
        disposeAuthorizedArtifact,
      });
    },
  );
  return { authorizeDisposal, disposeAuthorizedArtifact, host };
}

function fixture({
  observationHost = null,
  actionHost = null,
  navigationHost = null,
  keyboardHost = null,
  tabOpenHost = null,
  downloadHost = null,
  downloadDisposalHost = null,
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
    _getBrowserKeyboardActionHost: vi.fn(() => keyboardHost),
    _getBrowserTabOpenActionHost: vi.fn(() => tabOpenHost),
    _getBrowserDownloadActionHost: vi.fn(() => downloadHost),
    _getBrowserDownloadArtifactDisposalHost: vi.fn(() => downloadDisposalHost),
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

  it.each(["back", "forward", "refresh"])(
    "consumes one origin-bounded %s grant before history mutation",
    async (operation) => {
      const navigation = createNavigationHost();
      const engine = {
        navigateHistory: vi.fn(async () => ({
          success: true,
          operation,
          url: "https://example.test/after",
          title: "After",
        })),
      };
      const { handlers, getBrowserEngine } = fixture({
        navigationHost: navigation.host,
        engine,
      });
      const options = {
        waitUntil: "networkidle",
        allowedRedirectOrigins: ["https://example.test"],
        actionAuthorization: { approval: true },
      };

      await expect(
        handlers.get("browser:action:history")(
          {
            sender: { id: 17, getURL: () => "app://desktop/index.html" },
            senderFrame: { url: "app://desktop/index.html" },
          },
          "tab-1",
          operation,
          options,
        ),
      ).resolves.toMatchObject({
        success: true,
        operation,
        authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
        auditEventDigest: expect.stringMatching(/^sha256:/u),
      });
      expect(navigation.authorizeAction).toHaveBeenCalledBefore(
        getBrowserEngine,
      );
      expect(navigation.authorizeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          operation,
          destinationUrl: null,
          allowedRedirectOrigins: ["https://example.test"],
        }),
      );
      expect(engine.navigateHistory).toHaveBeenCalledWith("tab-1", operation, {
        waitUntil: "networkidle",
        allowedRedirectOrigins: ["https://example.test"],
      });
      expect(navigation.recordActionOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ operation, status: "succeeded" }),
      );
    },
  );

  it("rejects an unbounded history action before browser-engine access", async () => {
    const navigation = createNavigationHost();
    const { handlers, getBrowserEngine } = fixture({
      navigationHost: navigation.host,
      engine: { navigateHistory: vi.fn() },
    });

    await expect(
      handlers.get("browser:action:history")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "back",
        {},
      ),
    ).rejects.toThrow(/redirect origins/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("denies a key press before browser-engine access without its action host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    await expect(
      handlers.get("browser:action:key-press")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        { key: "Enter" },
      ),
    ).rejects.toThrow(/branded Desktop browser keyboard host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("denies a new tab before browser-engine access without its action host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    await expect(
      handlers.get("browser:action:open-tab")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "default",
        "https://example.test/path",
        {},
      ),
    ).rejects.toThrow(/branded Desktop browser tab open host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("opens one origin-bound tab and durably audits before returning", async () => {
    const tabOpen = createTabOpenHost();
    const engine = {
      openTab: vi.fn(async () => ({
        success: true,
        targetId: "tab-7",
        url: "https://login.test/complete",
        title: "Complete",
      })),
    };
    const { handlers, getBrowserEngine } = fixture({
      tabOpenHost: tabOpen.host,
      engine,
    });
    const options = {
      allowedRedirectOrigins: ["https://login.test", "https://example.test"],
      actionAuthorization: { approval: true },
    };

    await expect(
      handlers.get("browser:action:open-tab")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "default",
        "https://example.test/path",
        options,
      ),
    ).resolves.toMatchObject({
      success: true,
      targetId: "tab-7",
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(tabOpen.authorizeAction).toHaveBeenCalledBefore(getBrowserEngine);
    expect(engine.openTab).toHaveBeenCalledWith(
      "default",
      "https://example.test/path",
      {
        allowedRedirectOrigins: ["https://example.test", "https://login.test"],
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      },
    );
    expect(tabOpen.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(
      JSON.stringify(tabOpen.recordActionOutcome.mock.calls),
    ).not.toContain("https://login.test/complete");
  });

  it("rejects an unsafe tab URL before authority or engine access", async () => {
    const tabOpen = createTabOpenHost();
    const { handlers, getBrowserEngine } = fixture({
      tabOpenHost: tabOpen.host,
      engine: { openTab: vi.fn() },
    });
    await expect(
      handlers.get("browser:action:open-tab")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "default",
        "file:///secret",
        {},
      ),
    ).rejects.toThrow(/destination is invalid/u);
    expect(tabOpen.authorizeAction).not.toHaveBeenCalled();
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("consumes one key-bound grant immediately before the keyboard event", async () => {
    const keyboard = createKeyboardHost();
    const page = { keyboard: { press: vi.fn(async () => {}) } };
    const engine = { getPage: vi.fn(() => page) };
    const { handlers, getBrowserEngine } = fixture({
      keyboardHost: keyboard.host,
      engine,
    });
    const options = {
      key: "Enter",
      modifiers: ["Shift", "Control"],
      delay: 0,
      actionAuthorization: { approval: true },
    };

    await expect(
      handlers.get("browser:action:key-press")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        options,
      ),
    ).resolves.toMatchObject({
      success: true,
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(keyboard.authorizeAction).toHaveBeenCalledBefore(getBrowserEngine);
    expect(page.keyboard.press).toHaveBeenCalledWith("Control+Shift+Enter");
    expect(keyboard.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(
      JSON.stringify(keyboard.recordActionOutcome.mock.calls),
    ).not.toContain("Enter");
  });

  it("rejects arbitrary keyboard text before authority or engine access", async () => {
    const keyboard = createKeyboardHost();
    const { handlers, getBrowserEngine } = fixture({
      keyboardHost: keyboard.host,
      engine: { getPage: vi.fn() },
    });
    await expect(
      handlers.get("browser:action:key-press")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        { key: "Enter", text: "secret" },
      ),
    ).rejects.toThrow(/input is invalid/u);
    expect(keyboard.authorizeAction).not.toHaveBeenCalled();
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("denies a download before browser-engine access without its action host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    await expect(
      handlers.get("browser:action:download-url")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "https://example.test/report.pdf",
        { allowedContentTypes: ["application/pdf"] },
      ),
    ).rejects.toThrow(/branded Desktop browser download host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("executes one quarantined download and returns only opaque evidence", async () => {
    const download = createDownloadHost();
    const engine = { getPage: vi.fn(() => ({ id: "page-1" })) };
    const { handlers, getBrowserEngine } = fixture({
      downloadHost: download.host,
      engine,
    });
    const options = {
      allowedRedirectOrigins: [
        "https://cdn.example.test",
        "https://example.test",
      ],
      allowedContentTypes: ["application/pdf"],
      maxBytes: 1024 * 1024,
      actionAuthorization: { approval: true },
    };
    const result = await handlers.get("browser:action:download-url")(
      {
        sender: { id: 17, getURL: () => "app://desktop/index.html" },
        senderFrame: { url: "app://desktop/index.html" },
      },
      "tab-1",
      "https://example.test/private/report.pdf",
      options,
    );
    expect(result).toMatchObject({
      success: true,
      artifactRef: "quarantine:artifact-1",
      artifactDigest: expect.stringMatching(/^sha256:/u),
      scanEvidenceDigest: expect.stringMatching(/^sha256:/u),
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toContain("report.pdf");
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(download.authorizeAction).toHaveBeenCalledBefore(getBrowserEngine);
    expect(engine.getPage).toHaveBeenCalledWith("tab-1");
    expect(download.executeAuthorizedDownload).toHaveBeenCalledWith({
      receiptDigest: expect.stringMatching(/^sha256:/u),
      requestDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(download.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("rejects caller-controlled download paths before authority or engine access", async () => {
    const download = createDownloadHost();
    const { handlers, getBrowserEngine } = fixture({
      downloadHost: download.host,
      engine: { getPage: vi.fn() },
    });
    await expect(
      handlers.get("browser:action:download-url")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "https://example.test/report.pdf",
        {
          allowedContentTypes: ["application/pdf"],
          savePath: "C:\\private\\report.pdf",
        },
      ),
    ).rejects.toThrow(/input is invalid/u);
    expect(download.authorizeAction).not.toHaveBeenCalled();
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("durably audits a fail-closed download provider result", async () => {
    const download = createDownloadHost({ failed: true });
    const { handlers } = fixture({
      downloadHost: download.host,
      engine: { getPage: vi.fn(() => ({})) },
    });
    await expect(
      handlers.get("browser:action:download-url")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "tab-1",
        "https://example.test/report.pdf",
        { allowedContentTypes: ["application/pdf"] },
      ),
    ).resolves.toMatchObject({
      success: false,
      failureClass: "download-provider-failed",
      auditEventDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(download.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("cancels only an active download owned by the same renderer and audits it", async () => {
    let settleExecution;
    const executePort = vi.fn(
      () =>
        new Promise((resolve) => {
          settleExecution = resolve;
        }),
    );
    const cancelPort = vi.fn(async () => {
      settleExecution(
        Object.freeze({
          status: "failed",
          failureClass: "download-cancelled",
          artifactRef: null,
          artifactDigest: null,
          sizeBytes: null,
          contentType: null,
          finalUrlDigest: null,
          redirectOriginsDigest: null,
          scanEvidenceDigest: null,
          quarantineReceiptDigest: null,
          completionReceiptDigest: null,
          completedAt: null,
          resultDigest: digest("cancelled-result"),
        }),
      );
      return { accepted: true };
    });
    const download = createDownloadHost({ executePort, cancelPort });
    const { handlers } = fixture({
      downloadHost: download.host,
      engine: { getPage: vi.fn(() => ({})) },
    });
    const event = {
      sender: { id: 17, getURL: () => "app://desktop/index.html" },
      senderFrame: { url: "app://desktop/index.html" },
    };
    const downloadPromise = handlers.get("browser:action:download-url")(
      event,
      "tab-1",
      "https://example.test/report.pdf",
      { allowedContentTypes: ["application/pdf"] },
      "download-operation-1",
    );
    await vi.waitFor(() => expect(executePort).toHaveBeenCalledOnce());

    await expect(
      handlers.get("browser:action:cancel-download")(
        { ...event, sender: { ...event.sender, id: 18 } },
        "download-operation-1",
      ),
    ).rejects.toThrow(/not active/u);
    await expect(
      handlers.get("browser:action:cancel-download")(
        event,
        "download-operation-1",
      ),
    ).resolves.toEqual({
      success: true,
      status: "cancel-requested",
      operationId: "download-operation-1",
    });
    await expect(downloadPromise).resolves.toMatchObject({
      success: false,
      failureClass: "download-cancelled",
      auditEventDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(cancelPort).toHaveBeenCalledWith({
      receiptDigest: expect.stringMatching(/^sha256:/u),
      requestDigest: expect.stringMatching(/^sha256:/u),
      reason: "user-request",
    });
    expect(download.recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    await expect(
      handlers.get("browser:action:cancel-download")(
        event,
        "download-operation-1",
      ),
    ).rejects.toThrow(/not active/u);
  });

  it("denies artifact disposal without its signed host", async () => {
    const { handlers, getBrowserEngine } = fixture();
    await expect(
      handlers.get("browser:action:discard-download-artifact")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "quarantine:artifact-1",
        digest("artifact"),
        digest("download-receipt"),
        {},
      ),
    ).rejects.toThrow(/branded Desktop download artifact disposal host/u);
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("discards one exact artifact without exposing its custody reference", async () => {
    const disposal = createDownloadDisposalHost();
    const { handlers, getBrowserEngine } = fixture({
      downloadDisposalHost: disposal.host,
    });
    const result = await handlers.get(
      "browser:action:discard-download-artifact",
    )(
      {
        sender: { id: 17, getURL: () => "app://desktop/index.html" },
        senderFrame: { url: "app://desktop/index.html" },
      },
      "quarantine:artifact-1",
      digest("artifact"),
      digest("download-receipt"),
      { actionAuthorization: { approval: true } },
    );
    expect(result).toMatchObject({
      success: true,
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
      resultDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toContain("quarantine:artifact-1");
    expect(disposal.disposeAuthorizedArtifact).toHaveBeenCalledOnce();
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });

  it("rejects disposal reference traversal before authority", async () => {
    const disposal = createDownloadDisposalHost();
    const { handlers, getBrowserEngine } = fixture({
      downloadDisposalHost: disposal.host,
    });
    await expect(
      handlers.get("browser:action:discard-download-artifact")(
        {
          sender: { id: 17, getURL: () => "app://desktop/index.html" },
          senderFrame: { url: "app://desktop/index.html" },
        },
        "../../artifact",
        digest("artifact"),
        digest("download-receipt"),
        {},
      ),
    ).rejects.toThrow(/input is invalid/u);
    expect(disposal.authorizeDisposal).not.toHaveBeenCalled();
    expect(getBrowserEngine).not.toHaveBeenCalled();
  });
});
