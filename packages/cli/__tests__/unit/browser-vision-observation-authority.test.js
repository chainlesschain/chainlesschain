import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_VISION_OBSERVATION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_VISION_OBSERVATION_REQUEST_SCHEMA,
  BROWSER_VISION_OBSERVATION_RECEIPT_SCHEMA,
  captureBrowserVisionObservationAuthority,
  createBrowserVisionObservationAuthority,
} from "../../src/lib/evolution/browser-vision-observation-authority.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function descriptor() {
  return {
    schema: BROWSER_VISION_OBSERVATION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "browser-vision-test",
    tenantId: "tenant-test",
    handlerArtifactDigest: digest("handler"),
    policyRevision: "policy-7",
    maxGrantTtlMs: 10_000,
  };
}

function request(overrides = {}) {
  return {
    schema: BROWSER_VISION_OBSERVATION_REQUEST_SCHEMA,
    requestId: "request-1",
    targetId: "tab-1",
    operation: "analyze",
    senderId: 17,
    frameUrlDigest: digest("https://desktop.local"),
    inputDigest: digest("input"),
    authorization: { capability: "private-token" },
    requestedAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("browser vision observation authority", () => {
  it("returns a digest-bound receipt without leaking raw authorization", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decision: "allow",
      authorizationEvidenceRef: "did:example:operator#grant-1",
      validUntil: "2026-09-19T12:00:05.000Z",
    });
    const authority = createBrowserVisionObservationAuthority({
      descriptor: descriptor(),
      authorize,
      now: () => Date.parse("2026-09-19T12:00:00.000Z"),
    });
    const port = captureBrowserVisionObservationAuthority(authority);

    const receipt = await port.authorizeObservation(request());

    expect(receipt).toMatchObject({
      schema: BROWSER_VISION_OBSERVATION_RECEIPT_SCHEMA,
      authorityId: "browser-vision-test",
      tenantId: "tenant-test",
      targetId: "tab-1",
      operation: "analyze",
      senderId: 17,
      handlerArtifactDigest: descriptor().handlerArtifactDigest,
    });
    expect(receipt.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.authorizationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain("private-token");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: { capability: "private-token" },
        requestDigest: receipt.requestDigest,
      }),
    );
    expect(Object.keys(authority)).toEqual([]);
    expect(() => captureBrowserVisionObservationAuthority({})).toThrow(
      /branded/u,
    );
  });

  it("fails closed on denial, expiry, malformed input, and oversized authorization", async () => {
    const denied = captureBrowserVisionObservationAuthority(
      createBrowserVisionObservationAuthority({
        descriptor: descriptor(),
        authorize: async () => ({ decision: "deny", reason: "RBAC denied" }),
      }),
    );
    await expect(denied.authorizeObservation(request())).rejects.toMatchObject({
      code: "BROWSER_VISION_OBSERVATION_DENIED",
    });

    const expired = captureBrowserVisionObservationAuthority(
      createBrowserVisionObservationAuthority({
        descriptor: descriptor(),
        authorize: async () => ({
          decision: "allow",
          authorizationEvidenceRef: "expired",
          validUntil: "2026-09-19T12:00:00.000Z",
        }),
        now: () => Date.parse("2026-09-19T12:00:00.000Z"),
      }),
    );
    await expect(expired.authorizeObservation(request())).rejects.toThrow(
      /decision is invalid/u,
    );
    await expect(
      expired.authorizeObservation(request({ operation: "click" })),
    ).rejects.toThrow(/request is invalid/u);
    await expect(
      expired.authorizeObservation(
        request({ authorization: { value: "x".repeat(17 * 1024) } }),
      ),
    ).rejects.toThrow(/byte budget/u);
  });

  it("rejects accessor decisions without invoking their fields", async () => {
    const getter = vi.fn(() => "allow");
    const authority = captureBrowserVisionObservationAuthority(
      createBrowserVisionObservationAuthority({
        descriptor: descriptor(),
        authorize: async () =>
          Object.defineProperty({}, "decision", {
            enumerable: true,
            get: getter,
          }),
      }),
    );

    await expect(authority.authorizeObservation(request())).rejects.toThrow(
      /plain data/u,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
