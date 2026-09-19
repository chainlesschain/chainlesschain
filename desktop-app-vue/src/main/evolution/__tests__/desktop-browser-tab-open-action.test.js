import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserTabOpenAction,
  consumeDesktopBrowserTabOpenActionGrant,
  createDesktopBrowserTabOpenActionHost,
  recordDesktopBrowserTabOpenActionOutcome,
} = require("../desktop-browser-tab-open-action");

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
    authorityId: "tab-open-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) => ({
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
    destinationDigest: digest(
      "chainlesschain.browser-tab-open-action-destination/v1",
      request.destinationUrl,
    ),
    redirectOriginsDigest: digest(
      "chainlesschain.browser-tab-open-action-redirect-origins/v1",
      request.allowedRedirectOrigins,
    ),
    waitUntil: request.waitUntil,
    timeout: request.timeout,
    inputDigest: request.inputDigest,
    requestDigest: digest("test", `request:${request.requestId}`),
    validUntil: new Date(Date.now() + 5000).toISOString(),
    receiptDigest: digest("test", request.requestId),
  }));
  const recordActionOutcome = vi.fn(async (request) => ({
    schema: "chainlesschain.browser-tab-open-action-outcome-ack/v1",
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    actionReceiptDigest: request.actionReceiptDigest,
    outcomeRequestDigest: digest(request.schema, request),
    auditEventDigest: digest("test", `audit:${request.resultDigest}`),
    durabilityReceiptDigest: digest("test", `durable:${request.resultDigest}`),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  }));
  const host = createDesktopBrowserTabOpenActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

describe("Desktop browser tab open action host", () => {
  it("binds one normalized destination and redacts its durable outcome", async () => {
    const { host, authorizeAction, recordActionOutcome } = fixture();
    const options = {
      waitUntil: "networkidle",
      timeout: 45_000,
      allowedRedirectOrigins: ["https://login.test", "https://example.test"],
      actionAuthorization: { approval: "interactive" },
    };
    const grant = await authorizeDesktopBrowserTabOpenAction(host, {
      profileName: "default",
      destinationUrl: "https://example.test/path",
      options,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
      authorization: options.actionAuthorization,
    });
    expect(authorizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        profileName: "default",
        destinationUrl: "https://example.test/path",
        allowedRedirectOrigins: ["https://example.test", "https://login.test"],
      }),
    );
    expect(
      consumeDesktopBrowserTabOpenActionGrant(
        grant,
        "default",
        "https://example.test/path",
        options,
      ),
    ).toMatchObject({
      profileName: "default",
      destinationUrl: "https://example.test/path",
      receiptDigest: expect.stringMatching(/^sha256:/u),
    });
    await expect(
      recordDesktopBrowserTabOpenActionOutcome(grant, {
        status: "succeeded",
        targetId: "tab-7",
        finalUrl: "https://login.test/complete",
        failureClass: null,
      }),
    ).resolves.toMatchObject({
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(
      "https://login.test/complete",
    );
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(
      "tab-7",
    );
  });

  it("rejects unsafe destinations, redirect scopes and broad options before authority", async () => {
    const { host, authorizeAction } = fixture();
    for (const input of [
      { destinationUrl: "file:///secret", options: {} },
      {
        destinationUrl: "https://example.test/",
        options: { allowedRedirectOrigins: ["https://other.test"] },
      },
      {
        destinationUrl: "https://example.test/",
        options: { popup: true },
      },
    ]) {
      await expect(
        authorizeDesktopBrowserTabOpenAction(host, {
          profileName: "default",
          ...input,
          senderId: 17,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow();
    }
    expect(authorizeAction).not.toHaveBeenCalled();
  });

  it("rejects profile, destination and redirect-scope substitution or replay", async () => {
    const { host } = fixture();
    const options = { waitUntil: "load" };
    const grant = await authorizeDesktopBrowserTabOpenAction(host, {
      profileName: "default",
      destinationUrl: "https://example.test/path",
      options,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
    });
    for (const [profileName, destinationUrl, substituted] of [
      ["other", "https://example.test/path", options],
      ["default", "https://example.test/other", options],
      [
        "default",
        "https://example.test/path",
        {
          waitUntil: "load",
          allowedRedirectOrigins: [
            "https://example.test",
            "https://other.test",
          ],
        },
      ],
    ]) {
      expect(() =>
        consumeDesktopBrowserTabOpenActionGrant(
          grant,
          profileName,
          destinationUrl,
          substituted,
        ),
      ).toThrow(/fresh bound/u);
    }
    consumeDesktopBrowserTabOpenActionGrant(
      grant,
      "default",
      "https://example.test/path",
      options,
    );
    expect(() =>
      consumeDesktopBrowserTabOpenActionGrant(
        grant,
        "default",
        "https://example.test/path",
        options,
      ),
    ).toThrow(/fresh bound/u);
  });
});
