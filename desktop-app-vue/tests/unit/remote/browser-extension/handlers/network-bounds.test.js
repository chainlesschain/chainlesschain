import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearMockNetworkResponses,
  clearRequestBlocking,
  disableNetworkInterception,
  enableNetworkInterception,
  getNetworkRequests,
  mockNetworkResponse,
  setRequestBlocking,
} from "../../../../../src/main/remote/browser-extension/handlers/network.js";
import { NETWORK_SANITIZATION_LIMITS } from "../../../../../src/main/remote/browser-extension/handlers/network-boundary.js";

function createChromeMock({
  failNetworkEnable = false,
  failFetchEnable = false,
} = {}) {
  const eventListeners = new Set();
  const detachListeners = new Set();
  const onEvent = {
    addListener: vi.fn((listener) => eventListeners.add(listener)),
    removeListener: vi.fn((listener) => eventListeners.delete(listener)),
  };
  const onDetach = {
    addListener: vi.fn((listener) => detachListeners.add(listener)),
    removeListener: vi.fn((listener) => detachListeners.delete(listener)),
  };
  const emitDetach = (tabId) => {
    for (const listener of [...detachListeners]) {
      listener({ tabId }, "target_closed");
    }
  };
  const debuggerApi = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(async ({ tabId }) => emitDetach(tabId)),
    sendCommand: vi.fn(async (_source, method) => {
      if (method === "Network.enable" && failNetworkEnable) {
        throw new Error("network enable failed");
      }
      if (method === "Fetch.enable" && failFetchEnable) {
        throw new Error("fetch enable failed");
      }
      return undefined;
    }),
    onEvent,
    onDetach,
  };
  const updateDynamicRules = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("chrome", {
    debugger: debuggerApi,
    declarativeNetRequest: { updateDynamicRules },
  });

  return {
    debuggerApi,
    updateDynamicRules,
    eventListeners,
    detachListeners,
    emitEvent(tabId, method, params) {
      for (const listener of [...eventListeners]) {
        listener({ tabId }, method, params);
      }
    },
    emitDetach,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded network capture", () => {
  it("retains sanitized requests and responses and removes listeners", async () => {
    const mock = createChromeMock();
    await expect(enableNetworkInterception(501)).resolves.toMatchObject({
      success: true,
      limits: { maxActiveCaptures: 8, maxRequestsPerCapture: 500 },
    });
    mock.emitEvent(501, "Network.requestWillBeSent", {
      requestId: "request-1",
      request: {
        url: "u".repeat(NETWORK_SANITIZATION_LIMITS.maxUrlChars + 10),
        method: "GET",
        headers: { authorization: "secret" },
      },
      timestamp: 1,
      type: "Document",
    });
    mock.emitEvent(501, "Network.responseReceived", {
      requestId: "request-1",
      response: { status: 200, statusText: "OK", mimeType: "text/html" },
    });

    const captured = await getNetworkRequests(501);
    expect(captured).toMatchObject({
      status: "active",
      requests: [
        {
          id: "request-1",
          method: "GET",
          status: 200,
          mimeType: "text/html",
        },
      ],
    });
    expect(captured.requests[0].url).toHaveLength(
      NETWORK_SANITIZATION_LIMITS.maxUrlChars,
    );

    await expect(disableNetworkInterception(501)).resolves.toEqual({
      success: true,
    });
    expect((await getNetworkRequests(501)).status).toBe("inactive");
    expect(mock.eventListeners.size).toBe(0);
    expect(mock.detachListeners.size).toBe(0);
  });

  it("rejects duplicate capture and releases a failed start", async () => {
    const failed = createChromeMock({ failNetworkEnable: true });
    await expect(enableNetworkInterception(502)).resolves.toEqual({
      error: "network enable failed",
    });
    expect(failed.eventListeners.size).toBe(0);
    expect(failed.detachListeners.size).toBe(0);

    const recovered = createChromeMock();
    await expect(enableNetworkInterception(502)).resolves.toMatchObject({
      success: true,
    });
    await expect(enableNetworkInterception(502)).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "network_capture_tab",
    });
    await disableNetworkInterception(502);
  });

  it("releases capture admission when Chrome detaches externally", async () => {
    const mock = createChromeMock();
    await enableNetworkInterception(503);
    mock.emitDetach(503);
    expect((await getNetworkRequests(503)).status).toBe("inactive");
    expect(mock.eventListeners.size).toBe(0);
    await expect(enableNetworkInterception(503)).resolves.toMatchObject({
      success: true,
    });
    await disableNetworkInterception(503);
  });
});

describe("bounded request blocking and response mocks", () => {
  it("rejects oversized blocking input before changing dynamic rules", async () => {
    const mock = createChromeMock();
    await expect(
      setRequestBlocking(
        Array.from(
          { length: NETWORK_SANITIZATION_LIMITS.maxBlockingPatterns + 1 },
          (_, index) => `*://example.test/${index}`,
        ),
      ),
    ).resolves.toMatchObject({ code: "OVERLOADED" });
    expect(mock.updateDynamicRules).not.toHaveBeenCalled();

    await expect(
      setRequestBlocking(["*://example.test/*"]),
    ).resolves.toMatchObject({
      success: true,
      blockedPatterns: ["*://example.test/*"],
    });
    expect(mock.updateDynamicRules).toHaveBeenLastCalledWith(
      expect.objectContaining({
        addRules: [expect.objectContaining({ id: 1 })],
      }),
    );
    await clearRequestBlocking();
  });

  it("uses one listener per tab, fulfills Unicode mocks, and clears state", async () => {
    const mock = createChromeMock();
    await expect(
      mockNetworkResponse(504, "*://example.test/one*", {
        status: 201,
        body: { value: "你好" },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      mockNetworkResponse(504, "*://example.test/two*", {
        status: 202,
        body: { value: "second" },
      }),
    ).resolves.toMatchObject({ success: true });

    expect(mock.debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(mock.eventListeners.size).toBe(1);
    expect(mock.detachListeners.size).toBe(1);
    mock.emitEvent(504, "Fetch.requestPaused", {
      requestId: "paused-1",
      request: { url: "https://example.test/one/path" },
    });
    await vi.waitFor(() => {
      expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith(
        { tabId: 504 },
        "Fetch.fulfillRequest",
        expect.objectContaining({ requestId: "paused-1", responseCode: 201 }),
      );
    });
    const fulfill = mock.debuggerApi.sendCommand.mock.calls.find(
      ([, method]) => method === "Fetch.fulfillRequest",
    );
    expect(Buffer.from(fulfill[2].body, "base64").toString("utf8")).toBe(
      '{"value":"你好"}',
    );
    mock.emitEvent(504, "Fetch.requestPaused", {
      requestId: "paused-2",
      request: { url: "https://unmatched.test/path" },
    });
    await vi.waitFor(() => {
      expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith(
        { tabId: 504 },
        "Fetch.continueRequest",
        { requestId: "paused-2" },
      );
    });

    await expect(clearMockNetworkResponses(504)).resolves.toEqual({
      success: true,
    });
    expect(mock.eventListeners.size).toBe(0);
    expect(mock.detachListeners.size).toBe(0);
  });

  it("cleans a failed mock start and retains a live mock when disable fails", async () => {
    const failed = createChromeMock({ failFetchEnable: true });
    await expect(
      mockNetworkResponse(506, "*", { body: { ok: true } }),
    ).resolves.toEqual({ error: "fetch enable failed" });
    expect(failed.eventListeners.size).toBe(0);
    expect(failed.detachListeners.size).toBe(0);

    const recovered = createChromeMock();
    await expect(
      mockNetworkResponse(506, "*", { body: { ok: true } }),
    ).resolves.toMatchObject({ success: true });
    recovered.debuggerApi.sendCommand.mockRejectedValueOnce(
      new Error("fetch disable failed"),
    );
    await expect(clearMockNetworkResponses(506)).resolves.toEqual({
      error: "fetch disable failed",
    });
    expect(recovered.eventListeners.size).toBe(1);
    expect(recovered.detachListeners.size).toBe(1);

    recovered.debuggerApi.sendCommand.mockResolvedValue(undefined);
    await clearMockNetworkResponses(506);
    expect(recovered.eventListeners.size).toBe(0);
    expect(recovered.detachListeners.size).toBe(0);
  });

  it("transfers debugger ownership between capture and mock features", async () => {
    const mock = createChromeMock();
    mock.debuggerApi.attach
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Another debugger is already attached"));

    await enableNetworkInterception(505);
    await mockNetworkResponse(505, "*", { body: { ok: true } });
    await disableNetworkInterception(505);
    expect(mock.debuggerApi.detach).not.toHaveBeenCalled();
    expect(mock.eventListeners.size).toBe(1);

    await clearMockNetworkResponses(505);
    expect(mock.debuggerApi.detach).toHaveBeenCalledTimes(1);
    expect(mock.eventListeners.size).toBe(0);
  });
});
