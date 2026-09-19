import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_KEYBOARD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_KEYBOARD_ACTION_OUTCOME_ACK_SCHEMA,
  BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA,
  BROWSER_KEYBOARD_ACTION_REQUEST_SCHEMA,
  captureBrowserKeyboardActionAuthority,
  createBrowserKeyboardActionAuthority,
} from "../../src/lib/evolution/browser-keyboard-action-authority.js";

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

function descriptor() {
  return {
    schema: BROWSER_KEYBOARD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "keyboard-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 10_000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  };
}

function request(overrides = {}) {
  const inputCore = {
    targetId: "tab-1",
    operation: "key-press",
    key: "Enter",
    modifiers: ["Control", "Shift"],
    delay: 25,
  };
  return {
    schema: BROWSER_KEYBOARD_ACTION_REQUEST_SCHEMA,
    requestId: "request-1",
    targetId: inputCore.targetId,
    operation: inputCore.operation,
    senderId: 17,
    frameUrlDigest: digest("test", "frame"),
    key: inputCore.key,
    modifiers: inputCore.modifiers,
    delay: inputCore.delay,
    inputDigest: digest(
      "chainlesschain.browser-keyboard-action-input/v1",
      inputCore,
    ),
    authorization: { approval: "interactive" },
    requestedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function fixture(authorize = null) {
  const descriptorValue = descriptor();
  const recordOutcome = vi.fn(async (value) => ({
    schema: BROWSER_KEYBOARD_ACTION_OUTCOME_ACK_SCHEMA,
    authorityId: descriptorValue.authorityId,
    tenantId: descriptorValue.tenantId,
    handlerArtifactDigest: descriptorValue.handlerArtifactDigest,
    actionReceiptDigest: value.actionReceiptDigest,
    outcomeRequestDigest: value.outcomeRequestDigest,
    auditEventDigest: digest("test", `audit:${value.resultDigest}`),
    durabilityReceiptDigest: digest("test", `durable:${value.resultDigest}`),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  }));
  const authorizePort =
    authorize ??
    vi.fn(async () => ({
      decision: "allow",
      approvalEvidenceRef: "approval-1",
      validUntil: "2026-09-20T00:00:05.000Z",
    }));
  const port = captureBrowserKeyboardActionAuthority(
    createBrowserKeyboardActionAuthority({
      descriptor: descriptorValue,
      authorize: authorizePort,
      recordOutcome,
      now: () => Date.parse("2026-09-20T00:00:00.000Z"),
    }),
  );
  return { port, authorizePort, recordOutcome };
}

describe("browser keyboard action authority", () => {
  it("authorizes one key-bound action and durably settles its outcome", async () => {
    const { port, authorizePort, recordOutcome } = fixture();
    const receipt = await port.authorizeAction(request());
    expect(receipt).toMatchObject({
      targetId: "tab-1",
      operation: "key-press",
      keyDigest: expect.stringMatching(/^sha256:/u),
      inputDigest: request().inputDigest,
    });
    expect(JSON.stringify(receipt)).not.toContain("Enter");
    expect(authorizePort).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "Enter",
        modifiers: ["Control", "Shift"],
      }),
    );

    await expect(
      port.recordActionOutcome({
        schema: BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA,
        actionReceiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
        targetId: receipt.targetId,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        status: "succeeded",
        resultDigest: digest("test", "result"),
        recordedAt: "2026-09-20T00:00:01.000Z",
      }),
    ).resolves.toMatchObject({ durable: true, readbackVerified: true });
    expect(recordOutcome).toHaveBeenCalledOnce();
  });

  it("rejects text, embedded combinations, unknown modifiers and bad digest", async () => {
    const { port, authorizePort } = fixture();
    for (const invalid of [
      request({ key: "secret text" }),
      request({ key: "Control+Enter" }),
      request({ key: "F12" }),
      request({ modifiers: ["Ctrl"] }),
      request({ inputDigest: digest("test", "wrong") }),
    ]) {
      await expect(port.authorizeAction(invalid)).rejects.toThrow();
    }
    expect(authorizePort).not.toHaveBeenCalled();
  });

  it.each([
    ["ArrowLeft", ["Alt"]],
    ["t", ["Control"]],
    ["l", ["Meta"]],
    ["PageDown", ["Control"]],
  ])("rejects reserved browser shortcut %s", async (key, modifiers) => {
    const { port, authorizePort } = fixture();
    await expect(
      port.authorizeAction(request({ key, modifiers })),
    ).rejects.toThrow(/dedicated browser contract/u);
    expect(authorizePort).not.toHaveBeenCalled();
  });

  it("denies without issuing a receipt", async () => {
    const { port } = fixture(async () => ({
      decision: "deny",
      reason: "key is outside the approved task",
    }));
    await expect(port.authorizeAction(request())).rejects.toMatchObject({
      code: "BROWSER_KEYBOARD_ACTION_DENIED",
    });
  });

  it("rejects substituted or replayed outcome bindings", async () => {
    const { port } = fixture();
    const receipt = await port.authorizeAction(request());
    const outcome = {
      schema: BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA,
      actionReceiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
      targetId: receipt.targetId,
      operation: receipt.operation,
      inputDigest: receipt.inputDigest,
      status: "failed",
      resultDigest: digest("test", "failure"),
      recordedAt: "2026-09-20T00:00:01.000Z",
    };
    await expect(
      port.recordActionOutcome({ ...outcome, targetId: "tab-2" }),
    ).rejects.toThrow(/differs/u);
    await expect(port.recordActionOutcome(outcome)).resolves.toMatchObject({
      authenticated: true,
    });
    await expect(port.recordActionOutcome(outcome)).rejects.toThrow(/differs/u);
  });
});
