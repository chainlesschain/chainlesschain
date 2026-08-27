import { describe, expect, it } from "vitest";

import {
  DEFAULT_NETWORK_CAPTURE_LIMITS,
  HARD_NETWORK_CAPTURE_LIMITS,
  NETWORK_SANITIZATION_LIMITS,
  NetworkCaptureRegistry,
  NetworkMockRegistry,
  prepareMockResponse,
  sanitizeNetworkRequest,
  sanitizeNetworkResponse,
  validateBlockingPatterns,
} from "../../../../../src/main/remote/browser-extension/handlers/network-boundary.js";

describe("NetworkCaptureRegistry", () => {
  it("uses finite defaults and clamps capture configuration", () => {
    expect(new NetworkCaptureRegistry().getStats().limits).toEqual(
      DEFAULT_NETWORK_CAPTURE_LIMITS,
    );
    const hard = new NetworkCaptureRegistry({
      maxActiveCaptures: Number.MAX_SAFE_INTEGER,
      maxRetainedCaptures: Number.MAX_SAFE_INTEGER,
      maxRequestsPerCapture: Number.MAX_SAFE_INTEGER,
      maxBytesPerCapture: Number.MAX_SAFE_INTEGER,
      maxTotalBytes: Number.MAX_SAFE_INTEGER,
      maxEntryBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(hard.getStats().limits).toEqual(HARD_NETWORK_CAPTURE_LIMITS);
  });

  it("holds per-tab and global physical admission through stop", () => {
    const registry = new NetworkCaptureRegistry({ maxActiveCaptures: 1 });
    const first = registry.admit(1);
    expect(first.accepted).toBe(true);
    expect(registry.admit(1)).toMatchObject({
      code: "OVERLOADED",
      scope: "network_capture_tab",
    });
    expect(registry.admit(2)).toMatchObject({
      code: "OVERLOADED",
      scope: "network_captures",
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "NETWORK_CAPTURE_BUSY",
    });

    registry.markActive(first.lease);
    expect(registry.beginStop(1)).toMatchObject({
      accepted: true,
      capture: { status: "stopping" },
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "NETWORK_CAPTURE_BUSY",
    });
    registry.complete(first.lease);
    expect(registry.getStats().activeCaptures).toBe(0);
  });

  it("keeps a newest-first bounded request ring and merges bounded responses", () => {
    const registry = new NetworkCaptureRegistry({
      maxRequestsPerCapture: 2,
      maxBytesPerCapture: 1000,
      maxTotalBytes: 1000,
      maxEntryBytes: 1000,
    });
    const admission = registry.admit(3);
    registry.markActive(admission.lease);
    registry.recordRequest(admission.lease, { id: "one", url: "/one" });
    registry.recordRequest(admission.lease, { id: "two", url: "/two" });
    registry.recordResponse(admission.lease, {
      requestId: "two",
      status: 204,
    });
    registry.recordRequest(admission.lease, { id: "three", url: "/three" });

    expect(registry.getRequests(3)).toMatchObject({
      requests: [
        { id: "two", url: "/two", status: 204 },
        { id: "three", url: "/three" },
      ],
      droppedRequests: 1,
      droppedUpdates: 0,
      status: "active",
    });
    expect(
      registry.recordResponse(admission.lease, {
        requestId: "one",
        status: 500,
      }),
    ).toBe(false);
    expect(registry.getRequests(3).droppedUpdates).toBe(1);
  });

  it("evicts inactive captures before crossing the global byte cap", () => {
    const registry = new NetworkCaptureRegistry({
      maxActiveCaptures: 2,
      maxRetainedCaptures: 3,
      maxBytesPerCapture: 60,
      maxTotalBytes: 60,
      maxEntryBytes: 60,
    });
    const first = registry.admit(4);
    registry.markActive(first.lease);
    registry.recordRequest(first.lease, { id: "a", url: "x".repeat(20) });
    registry.complete(first.lease);

    const second = registry.admit(5);
    registry.markActive(second.lease);
    registry.recordRequest(second.lease, { id: "b", url: "y".repeat(20) });

    expect(registry.getRequests(4).requests).toEqual([]);
    expect(registry.getRequests(5).requests).toHaveLength(1);
    expect(registry.getStats().totalBytes).toBeLessThanOrEqual(60);
  });
});

describe("network input boundaries", () => {
  it("sanitizes request and response fields without retaining raw objects", () => {
    const longUrl = "u".repeat(NETWORK_SANITIZATION_LIMITS.maxUrlChars + 10);
    const rawHeaders = Object.fromEntries(
      Array.from(
        { length: NETWORK_SANITIZATION_LIMITS.maxHeaders + 5 },
        (_, index) => [`header-${index}`, "v".repeat(1000)],
      ),
    );
    const request = sanitizeNetworkRequest({
      requestId: "id",
      request: { url: longUrl, method: "GET", headers: rawHeaders },
    });
    const response = sanitizeNetworkResponse({
      requestId: "id",
      response: { status: 200, headers: rawHeaders, mimeType: longUrl },
    });

    expect(request.url).toHaveLength(NETWORK_SANITIZATION_LIMITS.maxUrlChars);
    expect(Object.keys(request.headers)).toHaveLength(
      NETWORK_SANITIZATION_LIMITS.maxHeaders,
    );
    expect(Object.values(request.headers)[0]).toHaveLength(
      NETWORK_SANITIZATION_LIMITS.maxHeaderValueChars,
    );
    expect(Object.keys(response.responseHeaders)).toHaveLength(
      NETWORK_SANITIZATION_LIMITS.maxHeaders,
    );
    expect(response.mimeType).toHaveLength(
      NETWORK_SANITIZATION_LIMITS.maxTextChars,
    );
    expect(request.headers).not.toBe(rawHeaders);

    const secrets = sanitizeNetworkRequest({
      request: {
        headers: {
          authorization: "Bearer secret",
          cookie: "session=secret",
          "x-api-key": "secret",
        },
      },
    });
    expect(secrets.headers).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-api-key": "[REDACTED]",
    });
  });

  it("rejects oversized or invalid blocking rules before Chrome APIs", () => {
    expect(validateBlockingPatterns("not-an-array")).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      validateBlockingPatterns(
        Array.from(
          { length: NETWORK_SANITIZATION_LIMITS.maxBlockingPatterns + 1 },
          (_, index) => `*://example.test/${index}`,
        ),
      ),
    ).toMatchObject({
      code: "OVERLOADED",
      scope: "network_blocking_patterns",
    });
    expect(
      validateBlockingPatterns([
        "x".repeat(NETWORK_SANITIZATION_LIMITS.maxPatternChars + 1),
      ]),
    ).toMatchObject({ code: "OVERLOADED" });
  });

  it("prepares bounded JSON mock responses and rejects circular bodies", () => {
    const prepared = prepareMockResponse("*://example.test/*", {
      status: 201,
      headers: { "x-test": "ok" },
      body: { message: "你好" },
    });
    expect(prepared).toMatchObject({
      accepted: true,
      mock: {
        status: 201,
        headers: [{ name: "x-test", value: "ok" }],
        bodyJson: '{"message":"你好"}',
      },
    });

    const circular = {};
    circular.self = circular;
    expect(prepareMockResponse("pattern", { body: circular })).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      prepareMockResponse("pattern", { body: () => "not-json" }),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(
      prepareMockResponse("pattern", {
        body: "x".repeat(NETWORK_SANITIZATION_LIMITS.maxMockBodyBytes + 1),
      }),
    ).toMatchObject({ code: "OVERLOADED", scope: "network_mock_body" });
  });
});

describe("NetworkMockRegistry", () => {
  function mock(urlPattern, bodyJson = "{}") {
    return { urlPattern, status: 200, headers: [], bodyJson };
  }

  it("bounds tabs and mocks, replaces entries, and supports rollback", () => {
    const registry = new NetworkMockRegistry({
      maxActiveTabs: 1,
      maxMocksPerTab: 2,
      maxBytesPerTab: 1000,
      maxTotalBytes: 1000,
      maxEntryBytes: 1000,
    });
    const first = registry.admit(10, mock("one"));
    expect(first).toMatchObject({ accepted: true, created: true });
    expect(registry.admit(11, mock("other"))).toMatchObject({
      code: "OVERLOADED",
      scope: "network_mock_tabs",
    });
    registry.markActive(first.lease);

    const second = registry.admit(10, mock("two"));
    expect(second).toMatchObject({ accepted: true, created: false });
    registry.rollback(second.rollback);
    expect(registry.getPatterns(10)).toEqual(["one"]);

    const replacement = registry.admit(10, mock("one", '{"v":2}'));
    expect(replacement.accepted).toBe(true);
    expect(registry.getMatch(10, "https://test/one").bodyJson).toBe('{"v":2}');
    expect(registry.getStats().totalBytes).toBeLessThanOrEqual(1000);
  });

  it("releases all retained bytes when a tab detaches", () => {
    const registry = new NetworkMockRegistry();
    const admission = registry.admit(12, mock("*"));
    registry.markActive(admission.lease);
    expect(registry.getMatch(12, "https://anything.test")).toMatchObject({
      urlPattern: "*",
    });
    expect(registry.getStats().totalBytes).toBeGreaterThan(0);
    registry.clear(12);
    expect(registry.getStats()).toMatchObject({
      activeTabs: 0,
      totalBytes: 0,
    });
  });
});
