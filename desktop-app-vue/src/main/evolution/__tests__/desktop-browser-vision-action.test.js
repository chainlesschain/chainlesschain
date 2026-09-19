import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserVisionObservation,
  consumeDesktopBrowserVisionObservationGrant,
  createDesktopBrowserVisionObservationHost,
} = require("../desktop-browser-vision-observation");
const {
  assertDesktopBrowserVisionActionGrant,
  authorizeDesktopBrowserVisionAction,
  consumeDesktopBrowserVisionActionGrant,
  createDesktopBrowserVisionActionHost,
  recordDesktopBrowserVisionActionOutcome,
} = require("../desktop-browser-vision-action");

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

function observationHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "observation-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("observation-handler"),
  });
  return createDesktopBrowserVisionObservationHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded observation");
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

function actionHost() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "action-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("action-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authorizeAction = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-vision-action-receipt/v1",
      authorityId: descriptor.authorityId,
      tenantId: descriptor.tenantId,
      handlerArtifactDigest: descriptor.handlerArtifactDigest,
      approvalMode: descriptor.approvalMode,
      requestId: request.requestId,
      targetId: request.targetId,
      operation: request.operation,
      senderId: request.senderId,
      frameUrlDigest: request.frameUrlDigest,
      inputDigest: request.inputDigest,
      observationReceiptDigest: request.observationReceiptDigest,
      requestDigest: digest(`request:${request.requestId}`),
      validUntil: new Date(Date.now() + 5000).toISOString(),
      receiptDigest: digest(request.requestId),
    }),
  );
  const recordActionOutcome = vi.fn(async (request) =>
    Object.freeze({
      schema: "chainlesschain.browser-vision-action-outcome-ack/v1",
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
  const host = createDesktopBrowserVisionActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded action");
    return Object.freeze({ descriptor, authorizeAction, recordActionOutcome });
  });
  return { host, authorizeAction, recordActionOutcome };
}

async function grants(
  options = { description: "submit button" },
  operation = "visual-click",
) {
  const observationGrant = await authorizeDesktopBrowserVisionObservation(
    observationHost(),
    {
      targetId: "tab-1",
      operation: "locate",
      options,
      senderId: 11,
      frameUrl: "app://desktop/index.html",
    },
  );
  const { host, authorizeAction, recordActionOutcome } = actionHost();
  const actionGrant = await authorizeDesktopBrowserVisionAction(host, {
    targetId: "tab-1",
    operation,
    options,
    observationGrant,
    senderId: 11,
    frameUrl: "app://desktop/index.html",
    authorization: { approval: "private" },
  });
  return {
    observationGrant,
    actionGrant,
    authorizeAction,
    recordActionOutcome,
  };
}

describe("Desktop browser vision action host", () => {
  it("requires the linked observation to be consumed before one interactive click", async () => {
    const options = { description: "submit button", clickCount: 1 };
    const {
      observationGrant,
      actionGrant,
      authorizeAction,
      recordActionOutcome,
    } = await grants(options);

    expect(() =>
      assertDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-click",
        options,
      ),
    ).not.toThrow();
    expect(() =>
      consumeDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-click",
        options,
      ),
    ).toThrow(/observation grant/u);

    consumeDesktopBrowserVisionObservationGrant(
      observationGrant,
      "tab-1",
      "locate",
      options,
    );
    expect(
      consumeDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-click",
        options,
      ),
    ).toMatchObject({ receiptDigest: expect.stringMatching(/^sha256:/u) });
    await expect(
      recordDesktopBrowserVisionActionOutcome(actionGrant, {
        status: "succeeded",
        clickedAt: { x: 10, y: 20 },
        button: "left",
        clickCount: 1,
        failureClass: null,
      }),
    ).resolves.toMatchObject({
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    await expect(
      recordDesktopBrowserVisionActionOutcome(actionGrant, {
        status: "succeeded",
        clickedAt: { x: 10, y: 20 },
        button: "left",
        clickCount: 1,
        failureClass: null,
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_ACTION_AUDIT_UNCERTAIN" });
    expect(() =>
      consumeDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-click",
        options,
      ),
    ).toThrow(/interactive action grant/u);
    expect(authorizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: { approval: "private" },
        observationReceiptDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    expect(recordActionOutcome).toHaveBeenCalledOnce();
  });

  it("rejects target, action-input, and host substitution", async () => {
    const options = { description: "submit button" };
    const { observationGrant, actionGrant } = await grants(options);
    expect(() =>
      assertDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-2",
        "visual-click",
        options,
      ),
    ).toThrow();
    expect(() =>
      assertDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-click",
        { description: "different button" },
      ),
    ).toThrow();
    await expect(
      authorizeDesktopBrowserVisionAction(null, {
        targetId: "tab-1",
        operation: "visual-click",
        options,
      }),
    ).rejects.toThrow(/branded Desktop/u);
  });

  it("binds one visual type grant to redacted text and durable outcome", async () => {
    const text = "private@example.test";
    const options = {
      description: "email input",
      text,
      delay: 10,
      clearExisting: true,
    };
    const {
      observationGrant,
      actionGrant,
      authorizeAction,
      recordActionOutcome,
    } = await grants(options, "visual-type");

    expect(() =>
      assertDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-type",
        options,
      ),
    ).not.toThrow();
    expect(JSON.stringify(authorizeAction.mock.calls)).not.toContain(text);
    expect(() =>
      assertDesktopBrowserVisionActionGrant(
        actionGrant,
        observationGrant,
        "tab-1",
        "visual-type",
        { ...options, text: "substituted@example.test" },
      ),
    ).toThrow(/interactive action grant/u);

    consumeDesktopBrowserVisionObservationGrant(
      observationGrant,
      "tab-1",
      "locate",
      options,
    );
    consumeDesktopBrowserVisionActionGrant(
      actionGrant,
      observationGrant,
      "tab-1",
      "visual-type",
      options,
    );
    await expect(
      recordDesktopBrowserVisionActionOutcome(actionGrant, {
        status: "succeeded",
        text,
        failureClass: null,
      }),
    ).resolves.toMatchObject({
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "visual-type",
        status: "succeeded",
        resultDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(text);
  });

  it("rejects visual type text above the UTF-8 byte budget", async () => {
    await expect(
      grants(
        {
          description: "large input",
          text: "密".repeat(22_000),
        },
        "visual-type",
      ),
    ).rejects.toThrow(/visual type options/u);
  });
});
