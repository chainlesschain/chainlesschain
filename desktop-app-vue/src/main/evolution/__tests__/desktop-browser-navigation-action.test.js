import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  assertDesktopBrowserNavigationActionGrant,
  authorizeDesktopBrowserNavigationAction,
  consumeDesktopBrowserNavigationActionGrant,
  createDesktopBrowserNavigationActionHost,
  recordDesktopBrowserNavigationActionOutcome,
} = require("../desktop-browser-navigation-action");

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;

function fixture() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "navigation-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
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
      destinationDigest: digest(
        "chainlesschain.browser-navigation-action-destination/v1",
        request.destinationUrl,
      ),
      redirectOriginsDigest: digest(
        "chainlesschain.browser-navigation-action-redirect-origins/v1",
        request.allowedRedirectOrigins,
      ),
      waitUntil: request.waitUntil,
      timeout: request.timeout,
      inputDigest: request.inputDigest,
      requestDigest: digest("test", `request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest("test", request.requestId),
    }),
  );
  const recordActionOutcome = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-navigation-action-outcome-ack/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      actionReceiptDigest: request.actionReceiptDigest,
      outcomeRequestDigest: digest(request.schema, request),
      auditEventDigest: digest("test", `audit:${request.resultDigest}`),
      durabilityReceiptDigest: digest(
        "test",
        `durable:${request.resultDigest}`,
      ),
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

describe("Desktop browser navigation action host", () => {
  it("binds one navigation grant and redacts URLs from durable evidence", async () => {
    const destinationUrl = "https://example.test/path?private=value";
    const options = {
      waitUntil: "networkidle",
      timeout: 45_000,
      allowedRedirectOrigins: [
        "https://example.test",
        "https://login.example.test",
      ],
    };
    const { host, authorizeAction, recordActionOutcome } = fixture();
    const grant = await authorizeDesktopBrowserNavigationAction(host, {
      targetId: "tab-1",
      destinationUrl,
      options,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
      authorization: { approval: "interactive" },
    });

    expect(() =>
      assertDesktopBrowserNavigationActionGrant(
        grant,
        "tab-1",
        destinationUrl,
        options,
      ),
    ).not.toThrow();
    expect(() =>
      assertDesktopBrowserNavigationActionGrant(
        grant,
        "tab-1",
        "https://different.test/",
        {
          ...options,
          allowedRedirectOrigins: ["https://different.test"],
        },
      ),
    ).toThrow(/interactive action grant/u);
    expect(() =>
      assertDesktopBrowserNavigationActionGrant(
        grant,
        "tab-1",
        destinationUrl,
        {
          ...options,
          allowedRedirectOrigins: [
            "https://example.test",
            "https://login.example.test",
            "https://unapproved.example.test",
          ],
        },
      ),
    ).toThrow(/interactive action grant/u);
    expect(JSON.stringify(authorizeAction.mock.calls)).toContain(
      destinationUrl,
    );

    consumeDesktopBrowserNavigationActionGrant(
      grant,
      "tab-1",
      destinationUrl,
      options,
    );
    await expect(
      recordDesktopBrowserNavigationActionOutcome(grant, {
        status: "succeeded",
        finalUrl: destinationUrl,
        failureClass: null,
      }),
    ).resolves.toMatchObject({
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(
      destinationUrl,
    );
  });

  it("rejects unsafe destinations before invoking the authority", async () => {
    const { host, authorizeAction } = fixture();
    await expect(
      authorizeDesktopBrowserNavigationAction(host, {
        targetId: "tab-1",
        destinationUrl: "file:///private/secret.txt",
        senderId: 17,
        frameUrl: "app://desktop/index.html",
      }),
    ).rejects.toThrow(/destination/u);
    expect(authorizeAction).not.toHaveBeenCalled();
  });

  it("does not allow grant replay after the navigation boundary", async () => {
    const destinationUrl = "https://example.test/";
    const { host } = fixture();
    const grant = await authorizeDesktopBrowserNavigationAction(host, {
      targetId: "tab-1",
      destinationUrl,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
    });
    consumeDesktopBrowserNavigationActionGrant(grant, "tab-1", destinationUrl);
    expect(() =>
      consumeDesktopBrowserNavigationActionGrant(
        grant,
        "tab-1",
        destinationUrl,
      ),
    ).toThrow(/interactive action grant/u);
  });
});
