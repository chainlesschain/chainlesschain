import { describe, expect, it, vi } from "vitest";
import {
  normalizeGatewayError,
  ResilientGatewayClient,
} from "../../src/lib/gateway-client-resilience.js";
import { CloudClient } from "../../src/lib/cloud/cloud-client.js";

const encoder = new TextEncoder();

function sseResponse(chunks, { close = true, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (close) controller.close();
      },
    }),
  };
}

function stalledSseResponse(chunks) {
  let index = 0;
  let resolvePending = null;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: {
      getReader() {
        return {
          read() {
            if (index < chunks.length) {
              return Promise.resolve({
                done: false,
                value: encoder.encode(chunks[index++]),
              });
            }
            return new Promise((resolve) => {
              resolvePending = resolve;
            });
          },
          cancel() {
            resolvePending?.({ done: true });
            return Promise.resolve();
          },
          releaseLock() {},
        };
      },
    },
  };
}

describe("ResilientGatewayClient", () => {
  it("parses keepalives and replayable SSE records without exposing transport details", async () => {
    const events = [];
    const onKeepalive = vi.fn();
    const client = new ResilientGatewayClient({
      baseUrl: "https://runner.example/private",
      fetch: async () =>
        sseResponse([
          ": keepalive\n\n",
          'id: event-7\nevent: progress\ndata: {"phase":"build"}\n\n',
        ]),
    });

    const result = await client.stream("/v1/jobs/job-7/events", {
      onEvent: (event) => events.push(event),
      onKeepalive,
    });

    expect(result).toEqual({
      lastEventId: "event-7",
      ended: true,
      reconnects: 0,
    });
    expect(onKeepalive).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { event: "progress", id: "event-7", data: '{"phase":"build"}' },
    ]);
  });

  it("reconnects after idle with the last safe event cursor and refreshes managed TLS/proxy authority", async () => {
    const calls = [];
    const tlsOne = { dispatcher: { revision: 1, dispatch() {} } };
    const tlsTwo = { dispatcher: { revision: 2, dispatch() {} } };
    const proxyOne = {
      dispatcher: {
        revision: "proxy-1",
        credential: "proxy-secret",
        dispatch() {},
      },
    };
    const proxyTwo = {
      dispatcher: {
        revision: "proxy-2",
        credential: "proxy-secret",
        dispatch() {},
      },
    };
    const tlsProvider = vi
      .fn()
      .mockResolvedValueOnce(tlsOne)
      .mockResolvedValueOnce(tlsTwo);
    const proxyAuthHelper = vi
      .fn()
      .mockResolvedValueOnce(proxyOne)
      .mockResolvedValueOnce(proxyTwo);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        stalledSseResponse(["id: resume-9\ndata: first\n\n"]),
      )
      .mockResolvedValueOnce(sseResponse(["id: resume-10\ndata: done\n\n"]));
    const client = new ResilientGatewayClient({
      baseUrl: "https://runner.example/api",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return fetch(url, init);
      },
      tlsProvider,
      proxyAuthHelper,
    });

    const result = await client.stream("/v1/jobs/job-9/events", {
      idleTimeoutMs: 100,
      maxReconnects: 1,
    });

    expect(result).toEqual({
      lastEventId: "resume-10",
      ended: true,
      reconnects: 1,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://runner.example/api/v1/jobs/job-9/events",
    );
    expect(calls[1].init.headers["Last-Event-ID"]).toBe("resume-9");
    expect(calls[0].init.headers).not.toHaveProperty("Proxy-Authorization");
    expect(JSON.stringify(calls[0].init.headers)).not.toContain("proxy-secret");
    expect(calls[0].init.dispatcher).toBe(proxyOne.dispatcher);
    expect(calls[1].init.dispatcher).toBe(proxyTwo.dispatcher);
    expect(tlsProvider).toHaveBeenCalledTimes(2);
    expect(proxyAuthHelper).toHaveBeenCalledTimes(2);
    expect(proxyAuthHelper).toHaveBeenNthCalledWith(1, {
      origin: "https://runner.example",
      tls: tlsOne,
    });
    expect(proxyAuthHelper).toHaveBeenNthCalledWith(2, {
      origin: "https://runner.example",
      tls: tlsTwo,
    });
  });

  it("rejects raw proxy authorization and route escapes instead of forwarding them to the origin", async () => {
    const fetch = vi.fn();
    const client = new ResilientGatewayClient({
      baseUrl: "https://runner.example",
      fetch,
      proxyAuthHelper: async () => "Basic proxy-secret",
    });

    await expect(client.stream("/v1/jobs/job/events")).rejects.toMatchObject({
      code: "CC_GATEWAY_PROXY_AUTH_UNAVAILABLE",
      message: "gateway proxy authentication is unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();

    const direct = new ResilientGatewayClient({
      baseUrl: "https://runner.example/private",
      fetch,
    });
    await expect(
      direct.stream("/v1/jobs/job/events", {
        headers: { "Proxy-Authorization": "Basic proxy-secret" },
      }),
    ).rejects.toMatchObject({ code: "CC_GATEWAY_OPTIONS_INVALID" });
    await expect(direct.stream("/../metadata")).rejects.toMatchObject({
      code: "CC_GATEWAY_PATH_INVALID",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid event streams and maps upstream failures to stable secret-free errors", async () => {
    const client = new ResilientGatewayClient({
      baseUrl: "https://runner.example",
      fetch: async () => ({
        ok: false,
        status: 502,
        headers: new Headers(),
      }),
    });
    await expect(client.stream("/v1/jobs/job/events")).rejects.toMatchObject({
      code: "CC_GATEWAY_UPSTREAM_UNAVAILABLE",
      message: "gateway upstream is temporarily unavailable",
    });

    const normalized = normalizeGatewayError({
      code: "ECONNRESET",
      message: "https://proxy.example/?token=top-secret",
    });
    expect(normalized).toMatchObject({
      code: "CC_GATEWAY_TRANSPORT_UNAVAILABLE",
      message: "gateway transport is temporarily unavailable",
    });
    expect(normalized.message).not.toContain("top-secret");

    const normalizedCause = normalizeGatewayError({
      code: "ERR_FETCH_FAILED",
      cause: {
        code: "ECONNRESET",
        message: "https://proxy.example/?token=top-secret",
      },
    });
    expect(normalizedCause).toMatchObject({
      code: "CC_GATEWAY_TRANSPORT_UNAVAILABLE",
      message: "gateway transport is temporarily unavailable",
    });
    expect(normalizedCause.message).not.toContain("top-secret");
  });

  it("bounds unterminated SSE frame bytes and line counts with stable errors", async () => {
    const byteBoundClient = new ResilientGatewayClient({
      baseUrl: "https://runner.example",
      fetch: async () =>
        sseResponse([
          `data: sse-secret-${"x".repeat(600 * 1024)}`,
          "x".repeat(600 * 1024),
        ]),
    });
    await expect(
      byteBoundClient.stream("/v1/jobs/job/events"),
    ).rejects.toMatchObject({
      code: "CC_GATEWAY_SSE_FRAME_INVALID",
      message: "gateway event frame is invalid",
    });

    const lineBoundClient = new ResilientGatewayClient({
      baseUrl: "https://runner.example",
      fetch: async () =>
        sseResponse([
          `${Array.from({ length: 4097 }, () => "event: sse-secret").join("\n")}\n\n`,
        ]),
    });
    await expect(
      lineBoundClient.stream("/v1/jobs/job/events"),
    ).rejects.toMatchObject({
      code: "CC_GATEWAY_SSE_FRAME_INVALID",
      message: "gateway event frame is invalid",
    });
  });

  it("recovers when Node fetch exposes a retryable code through error.cause", async () => {
    const cause = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
      .mockResolvedValueOnce(sseResponse(["data: recovered\n\n"]));
    const client = new ResilientGatewayClient({
      baseUrl: "https://runner.example",
      fetch,
    });

    await expect(
      client.stream("/v1/jobs/job/events", { maxReconnects: 1 }),
    ).resolves.toEqual({ lastEventId: "", ended: true, reconnects: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("offers the resilient event endpoint through CloudClient without changing polling APIs", async () => {
    const gateway = { stream: vi.fn().mockResolvedValue({ ended: true }) };
    const cloud = new CloudClient({
      baseUrl: "https://runner.example",
      gateway,
      deps: { fetch: vi.fn() },
    });

    await expect(cloud.events("job.7")).resolves.toEqual({ ended: true });
    expect(gateway.stream).toHaveBeenCalledWith("/v1/jobs/job.7/events", {});
    await expect(cloud.events("../unsafe")).rejects.toThrow(/invalid job id/i);
  });

  it("uses the Runner bearer token for SSE without treating it as proxy authority", async () => {
    let request;
    const cloud = new CloudClient({
      baseUrl: "https://runner.example",
      token: "runner-token",
      deps: {
        fetch: async (_url, init) => {
          request = init;
          return sseResponse([]);
        },
      },
    });

    await cloud.events("job-7");
    expect(request.headers.Authorization).toBe("Bearer runner-token");
    expect(request.headers).not.toHaveProperty("Proxy-Authorization");
  });
});
