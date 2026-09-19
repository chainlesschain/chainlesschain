import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserVisionObservation,
  consumeDesktopBrowserVisionObservationGrant,
  createDesktopBrowserVisionObservationHost,
} = require("../desktop-browser-vision-observation");

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function fixture() {
  const descriptor = Object.freeze({
    authorityId: "vision-authority",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
  });
  const authorizeObservation = vi.fn(async (request) =>
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
  );
  const authority = Object.freeze({});
  const capture = vi.fn((value) => {
    if (value !== authority) throw new TypeError("unbranded authority");
    return Object.freeze({ descriptor, authorizeObservation });
  });
  const host = createDesktopBrowserVisionObservationHost(authority, capture);
  return { host, authorizeObservation };
}

describe("Desktop browser vision observation host", () => {
  it("binds a one-use grant to sender, frame, target, operation, and input", async () => {
    const { host, authorizeObservation } = fixture();
    const options = {
      prompt: "describe",
      maxTokens: 128,
      observationAuthorization: { vc: "private-vc" },
    };
    const grant = await authorizeDesktopBrowserVisionObservation(host, {
      targetId: "tab-1",
      operation: "analyze",
      options,
      senderId: 7,
      frameUrl: "app://desktop/index.html",
      authorization: options.observationAuthorization,
    });

    expect(authorizeObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "tab-1",
        operation: "analyze",
        senderId: 7,
        authorization: { vc: "private-vc" },
      }),
    );
    expect(
      consumeDesktopBrowserVisionObservationGrant(
        grant,
        "tab-1",
        "analyze",
        options,
      ),
    ).toMatchObject({ receiptDigest: expect.stringMatching(/^sha256:/u) });
    expect(() =>
      consumeDesktopBrowserVisionObservationGrant(
        grant,
        "tab-1",
        "analyze",
        options,
      ),
    ).toThrow(/fresh bound observation grant/u);
  });

  it("rejects substitution and an unbranded host before authority dispatch", async () => {
    const { host, authorizeObservation } = fixture();
    const options = { description: "login button" };
    const grant = await authorizeDesktopBrowserVisionObservation(host, {
      targetId: "tab-1",
      operation: "locate",
      options,
      senderId: 9,
      frameUrl: "app://desktop/index.html",
    });

    expect(() =>
      consumeDesktopBrowserVisionObservationGrant(
        grant,
        "tab-2",
        "locate",
        options,
      ),
    ).toThrow(/fresh bound observation grant/u);
    await expect(
      authorizeDesktopBrowserVisionObservation(null, {
        targetId: "tab-1",
        operation: "analyze",
      }),
    ).rejects.toThrow(/branded Desktop/u);
    expect(authorizeObservation).toHaveBeenCalledOnce();
  });

  it("rejects malformed screenshot options and accessors before authority dispatch", async () => {
    const { host, authorizeObservation } = fixture();
    for (const options of [
      { model: "caller-controlled" },
      { maxTokens: 4097 },
      { temperature: 2 },
      { quality: 0 },
      { fullPage: "yes" },
      { detail: "original" },
      { clip: { x: 0, y: 0, width: -1, height: 100 } },
    ]) {
      await expect(
        authorizeDesktopBrowserVisionObservation(host, {
          targetId: "tab-1",
          operation: "analyze",
          options,
          senderId: 7,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow();
    }
    const getter = vi.fn(() => "secret");
    const accessorOptions = Object.defineProperty({}, "prompt", {
      enumerable: true,
      get: getter,
    });
    await expect(
      authorizeDesktopBrowserVisionObservation(host, {
        targetId: "tab-1",
        operation: "analyze",
        options: accessorOptions,
        senderId: 7,
        frameUrl: "app://desktop/index.html",
      }),
    ).rejects.toThrow(/plain data/u);
    expect(getter).not.toHaveBeenCalled();
    expect(authorizeObservation).not.toHaveBeenCalled();
  });
});
