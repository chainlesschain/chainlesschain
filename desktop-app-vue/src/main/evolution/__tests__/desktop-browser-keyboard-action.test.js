import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserKeyboardAction,
  consumeDesktopBrowserKeyboardActionGrant,
  createDesktopBrowserKeyboardActionHost,
  recordDesktopBrowserKeyboardActionOutcome,
} = require("../desktop-browser-keyboard-action");

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
    authorityId: "keyboard-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) => ({
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
    keyDigest: digest("chainlesschain.browser-keyboard-action-key/v1", {
      key: request.key,
      modifiers: request.modifiers,
    }),
    delay: request.delay,
    inputDigest: request.inputDigest,
    requestDigest: digest("test", `request:${request.requestId}`),
    validUntil: new Date(Date.now() + 5000).toISOString(),
    receiptDigest: digest("test", request.requestId),
  }));
  const recordActionOutcome = vi.fn(async (request) => ({
    schema: "chainlesschain.browser-keyboard-action-outcome-ack/v1",
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
  const host = createDesktopBrowserKeyboardActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

describe("Desktop browser keyboard action host", () => {
  it("binds and consumes one normalized key press without raw audit data", async () => {
    const { host, authorizeAction, recordActionOutcome } = fixture();
    const options = {
      key: "Enter",
      modifiers: ["Shift", "Control"],
      delay: 20,
      actionAuthorization: { approval: "interactive" },
    };
    const grant = await authorizeDesktopBrowserKeyboardAction(host, {
      targetId: "tab-1",
      options,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
      authorization: options.actionAuthorization,
    });
    expect(authorizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "Enter",
        modifiers: ["Control", "Shift"],
        delay: 20,
      }),
    );
    expect(
      consumeDesktopBrowserKeyboardActionGrant(grant, "tab-1", options),
    ).toMatchObject({
      key: "Enter",
      modifiers: ["Control", "Shift"],
      delay: 20,
      receiptDigest: expect.stringMatching(/^sha256:/u),
    });
    await expect(
      recordDesktopBrowserKeyboardActionOutcome(grant, {
        status: "succeeded",
        failureClass: null,
      }),
    ).resolves.toMatchObject({
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(
      "Enter",
    );
  });

  it("rejects text, presets, embedded combinations and unknown modifiers before authority", async () => {
    const { host, authorizeAction } = fixture();
    for (const options of [
      { key: "Enter", text: "secret" },
      { key: "Enter", preset: "SUBMIT" },
      { key: "Control+Enter" },
      { key: "F12" },
      { key: "Enter", modifiers: ["Ctrl"] },
    ]) {
      await expect(
        authorizeDesktopBrowserKeyboardAction(host, {
          targetId: "tab-1",
          options,
          senderId: 17,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow();
    }
    expect(authorizeAction).not.toHaveBeenCalled();
  });

  it("does not allow key, target, modifier or grant replay", async () => {
    const { host } = fixture();
    const options = { key: "a", modifiers: ["Control"] };
    const grant = await authorizeDesktopBrowserKeyboardAction(host, {
      targetId: "tab-1",
      options,
      senderId: 17,
      frameUrl: "app://desktop/index.html",
    });
    for (const [targetId, substituted] of [
      ["tab-2", options],
      ["tab-1", { key: "b", modifiers: ["Control"] }],
      ["tab-1", { key: "a", modifiers: ["Shift"] }],
    ]) {
      expect(() =>
        consumeDesktopBrowserKeyboardActionGrant(grant, targetId, substituted),
      ).toThrow(/fresh bound/u);
    }
    consumeDesktopBrowserKeyboardActionGrant(grant, "tab-1", options);
    expect(() =>
      consumeDesktopBrowserKeyboardActionGrant(grant, "tab-1", options),
    ).toThrow(/fresh bound/u);
  });

  it.each([
    ["ArrowLeft", ["Alt"]],
    ["t", ["Control"]],
    ["l", ["Meta"]],
    ["PageDown", ["Control"]],
  ])(
    "rejects reserved browser shortcut %s before authority",
    async (key, modifiers) => {
      const { host, authorizeAction } = fixture();
      await expect(
        authorizeDesktopBrowserKeyboardAction(host, {
          targetId: "tab-1",
          options: { key, modifiers },
          senderId: 17,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow(/dedicated contract/u);
      expect(authorizeAction).not.toHaveBeenCalled();
    },
  );
});
