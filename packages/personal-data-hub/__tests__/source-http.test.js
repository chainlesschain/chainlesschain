"use strict";

import { describe, expect, it } from "vitest";

const { buildSourceUrl, createJsonSourceFetch } = require("../lib/source-http");
const publicApi = require("../lib");

describe("source HTTPS/JSON transport", () => {
  it("is exposed by the package root used by CLI and Electron wiring", () => {
    expect(publicApi.createJsonSourceFetch).toBe(createJsonSourceFetch);
  });

  it("maps structured adapter requests to HTTPS fetch without exposing cookies in the URL", async () => {
    let captured = null;
    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init };
        return new Response(JSON.stringify({ orders: [{ id: "o-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await sourceFetch({
      url: "https://orders.example.test/list?fixed=1",
      cookies: "sid=secret",
      query: { page: 2, tags: ["paid", "recent"], nested: { a: 1 } },
      sign: "signed",
      antiToken: "anti",
    });

    const url = new URL(captured.url);
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("fixed")).toBe("1");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.getAll("tags")).toEqual(["paid", "recent"]);
    expect(url.searchParams.get("nested")).toBe('{"a":1}');
    expect(url.searchParams.get("sign")).toBe("signed");
    expect(url.searchParams.get("anti_token")).toBe("anti");
    expect(captured.url).not.toContain("sid=secret");
    expect(captured.init.headers.get("cookie")).toBe("sid=secret");
    expect(captured.init.method).toBe("GET");
    expect(captured.init.redirect).toBe("manual");
    expect(result.orders).toHaveLength(1);
  });

  it("serializes object bodies as JSON and preserves explicit headers", async () => {
    let captured = null;
    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async (_url, init) => {
        captured = init;
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await sourceFetch({
      url: "https://orders.example.test/query",
      method: "POST",
      headers: { "x-source": "test" },
      body: { cursor: "next" },
    });

    expect(captured.method).toBe("POST");
    expect(captured.body).toBe('{"cursor":"next"}');
    expect(captured.headers.get("content-type")).toBe("application/json");
    expect(captured.headers.get("x-source")).toBe("test");
  });

  it("serializes adapter form requests as bounded POST bodies", async () => {
    let captured = null;
    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async (_url, init) => {
        captured = init;
        return new Response('{"data":{"orders":[]}}', { status: 200 });
      },
    });

    await sourceFetch({
      url: "https://orders.example.test/query",
      form: {
        pageIndex: 2,
        queryType: "1",
        tags: ["completed", "recent"],
      },
    });

    expect(captured.method).toBe("POST");
    expect(captured.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    const body = new URLSearchParams(String(captured.body));
    expect(body.get("pageIndex")).toBe("2");
    expect(body.get("queryType")).toBe("1");
    expect(body.getAll("tags")).toEqual(["completed", "recent"]);
    await expect(
      sourceFetch({
        url: "https://orders.example.test/query",
        form: { page: 1 },
        body: { page: 2 },
      }),
    ).rejects.toThrow(/mutually exclusive/u);
  });

  it("fails explicitly for HTTP errors, non-JSON, empty, and oversized responses", async () => {
    const httpFailure = createJsonSourceFetch({
      fetchImpl: async () => new Response("denied", { status: 403 }),
    });
    await expect(
      httpFailure({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_HTTP_ERROR", status: 403 });

    const htmlFailure = createJsonSourceFetch({
      fetchImpl: async () =>
        new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    await expect(
      htmlFailure({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_NOT_JSON" });

    const emptyFailure = createJsonSourceFetch({
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    await expect(
      emptyFailure({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_EMPTY_RESPONSE" });

    const oversizedFailure = createJsonSourceFetch({
      maxResponseBytes: 4,
      fetchImpl: async () => new Response('{"too":"large"}', { status: 200 }),
    });
    await expect(
      oversizedFailure({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_TOO_LARGE" });
  });

  it("enforces the byte limit while a chunked response is still streaming", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"'));
        controller.enqueue(new TextEncoder().encode('123456789"}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const sourceFetch = createJsonSourceFetch({
      maxResponseBytes: 8,
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });

    await expect(
      sourceFetch({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("follows bounded same-origin GET redirects and rejects cross-origin or POST redirects", async () => {
    const requested = [];
    const sameOriginFetch = createJsonSourceFetch({
      fetchImpl: async (url) => {
        requested.push(String(url));
        return requested.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "/orders?page=2" },
            })
          : new Response('{"ok":true}', { status: 200 });
      },
    });
    await expect(
      sameOriginFetch({ url: "https://orders.example.test/start" }),
    ).resolves.toEqual({ ok: true });
    expect(requested).toEqual([
      "https://orders.example.test/start",
      "https://orders.example.test/orders?page=2",
    ]);

    const crossOriginFetch = createJsonSourceFetch({
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://collector.example.test/orders" },
        }),
    });
    await expect(
      crossOriginFetch({
        url: "https://orders.example.test/start",
        cookies: "sid=secret",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REDIRECT_NOT_ALLOWED" });

    const postRedirectFetch = createJsonSourceFetch({
      fetchImpl: async () =>
        new Response(null, {
          status: 307,
          headers: { location: "/orders" },
        }),
    });
    await expect(
      postRedirectFetch({
        url: "https://orders.example.test/start",
        method: "POST",
        body: { cursor: "next" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REDIRECT_NOT_ALLOWED" });
  });

  it("rejects an oversized Cookie header before issuing a request", async () => {
    let called = false;
    const sourceFetch = createJsonSourceFetch({
      maxCookieBytes: 4,
      fetchImpl: async () => {
        called = true;
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    await expect(
      sourceFetch({
        url: "https://orders.example.test/list",
        cookies: "sid=secret",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_COOKIE_TOO_LARGE" });
    await expect(
      sourceFetch({
        url: "https://orders.example.test/list",
        headers: { cookie: "sid=secret" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_COOKIE_TOO_LARGE" });
    expect(called).toBe(false);
  });

  it("enforces HTTPS and aborts a stalled request at the configured timeout", async () => {
    expect(() =>
      buildSourceUrl({ url: "http://orders.example.test/list" }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      buildSourceUrl({
        url: "https://user:pass@orders.example.test/list",
      }),
    ).toThrow(/credential-free/u);

    const sourceFetch = createJsonSourceFetch({
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        }),
    });
    await expect(
      sourceFetch({ url: "https://orders.example.test/list" }),
    ).rejects.toMatchObject({ code: "SOURCE_REQUEST_TIMEOUT" });
  });
});
