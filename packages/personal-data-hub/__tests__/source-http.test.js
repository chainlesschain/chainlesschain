"use strict";

import { describe, expect, it } from "vitest";
import { inspect } from "node:util";

const {
  DEFAULT_MAX_REQUEST_BYTES,
  buildSourceUrl,
  createJsonSourceFetch,
  createJsonResponseSourceFetch,
} = require("../lib/source-http");
const publicApi = require("../lib");

describe("source HTTPS/JSON transport", () => {
  it("is exposed by the package root used by CLI and Electron wiring", () => {
    expect(publicApi.createJsonSourceFetch).toBe(createJsonSourceFetch);
    expect(publicApi.createJsonResponseSourceFetch).toBe(
      createJsonResponseSourceFetch,
    );
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

  it("places required OAuth URL parameters without echoing them in transport errors", async () => {
    const accessToken = "oauth-runtime-secret";
    const built = buildSourceUrl({
      url: "https://pan.baidu.com/rest/2.0/xpan/file",
      query: { method: "list", dir: "/", start: 0, limit: 1000 },
      credentialQuery: { access_token: accessToken },
    });
    expect(built.searchParams.get("access_token")).toBe(accessToken);
    expect(built.searchParams.get("method")).toBe("list");

    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async () => new Response("denied", { status: 401 }),
    });
    let failure = null;
    try {
      await sourceFetch({
        url: "https://pan.baidu.com/rest/2.0/xpan/file",
        credentialQuery: { access_token: accessToken },
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-kso-authorization": "KSO-1 app-id:runtime-signature",
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "SOURCE_HTTP_ERROR",
      status: 401,
    });
    expect(String(failure)).not.toContain(accessToken);
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
      preserveHttpErrorResponse: true,
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
    let failure = null;
    try {
      await sourceFetch({
        url: "https://orders.example.test/list?token=timeout-secret",
        headers: { cookie: "sid=timeout-cookie" },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "SOURCE_REQUEST_TIMEOUT" });
    expect(failure).not.toHaveProperty("cause");
    expect(inspect(failure)).not.toContain("timeout-secret");
    expect(inspect(failure)).not.toContain("timeout-cookie");
  });

  it("sanitizes fetch implementation errors without trusting their error code or fields", async () => {
    const urlSecret = "query-runtime-secret";
    const cookieSecret = "cookie-runtime-secret";
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async (url, init) => {
        const error = new Error(
          `failed ${String(url)} ${init.headers.get("cookie")}`,
        );
        error.code = "SOURCE_HTTP_ERROR";
        error.request = {
          headers: Object.fromEntries(init.headers),
          url: String(url),
        };
        throw error;
      },
    });

    let failure = null;
    try {
      await sourceFetch(`https://api.example.test/orders?token=${urlSecret}`, {
        headers: { cookie: `sid=${cookieSecret}` },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "SOURCE_REQUEST_FAILED" });
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("request");
    expect(inspect(failure)).not.toContain(urlSecret);
    expect(inspect(failure)).not.toContain(cookieSecret);

    const structuredFetch = createJsonSourceFetch({
      fetchImpl: async (url) => {
        throw new Error(`network failed for ${String(url)}`);
      },
    });
    await expect(
      structuredFetch({
        url: `https://api.example.test/orders?token=${urlSecret}`,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REQUEST_FAILED" });
  });

  it("bounds Request bodies before issuing a request and times out stalled body streams", async () => {
    let called = 0;
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      maxRequestBytes: 4,
      timeoutMs: 20,
      fetchImpl: async () => {
        called += 1;
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    await expect(
      sourceFetch("https://api.example.test/orders", {
        method: "POST",
        body: "12345",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REQUEST_TOO_LARGE" });
    expect(called).toBe(0);

    const defaultBoundedFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async () => {
        called += 1;
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    await expect(
      defaultBoundedFetch("https://api.example.test/orders", {
        method: "POST",
        headers: {
          "content-length": String(DEFAULT_MAX_REQUEST_BYTES + 1),
        },
        body: "x",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REQUEST_TOO_LARGE" });
    expect(called).toBe(0);

    const stalledBody = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    });
    await expect(
      sourceFetch("https://api.example.test/orders", {
        body: stalledBody,
        duplex: "half",
        method: "POST",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REQUEST_TIMEOUT" });
    expect(called).toBe(0);
  });

  it("propagates caller abort reasons while a Request body is being read", async () => {
    let reading;
    const readingStarted = new Promise((resolve) => {
      reading = resolve;
    });
    const stalledBody = new ReadableStream({
      pull() {
        reading();
        return new Promise(() => {});
      },
    });
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      timeoutMs: 1_000,
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    });
    const controller = new AbortController();
    const reason = new Error("collector cancelled during body read");
    const pending = sourceFetch("https://api.example.test/orders", {
      body: stalledBody,
      duplex: "half",
      method: "POST",
      signal: controller.signal,
    });
    await readingStarted;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("adapts URL and Request inputs to a validated WHATWG Response", async () => {
    const captured = [];
    const responseBody = ' { "orders": [{ "id": "o-1" }] } ';
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async (url, init) => {
        captured.push({ url: String(url), init });
        return new Response(responseBody, {
          status: 201,
          statusText: "Created",
          headers: {
            "content-encoding": "gzip",
            "content-length": String(Buffer.byteLength(responseBody, "utf8")),
            "content-type": "application/json; charset=utf-8",
            "transfer-encoding": "chunked",
            "x-source-page": "2",
          },
        });
      },
    });

    const response = await sourceFetch(
      new Request("https://api.example.test/orders", {
        method: "POST",
        headers: {
          cookie: "sid=runtime-secret",
          "content-type": "application/json",
        },
        body: '{"page":2}',
      }),
    );
    const responseClone = response.clone();

    expect(response).toBeInstanceOf(Response);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-source-page")).toBe("2");
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("transfer-encoding")).toBe(false);
    expect(response.url).toBe("");
    expect(response.redirected).toBe(false);
    expect(response.type).toBe("default");
    expect(await response.json()).toEqual({ orders: [{ id: "o-1" }] });
    expect(await responseClone.text()).toBe(responseBody);
    expect(captured[0].url).toBe("https://api.example.test/orders");
    expect(captured[0].init.method).toBe("POST");
    expect(captured[0].init.headers.get("cookie")).toBe("sid=runtime-secret");
    expect(Buffer.from(captured[0].init.body).toString("utf8")).toBe(
      '{"page":2}',
    );

    const exactHostResponse = await sourceFetch("https://example.test/root");
    expect(await exactHostResponse.json()).toEqual({
      orders: [{ id: "o-1" }],
    });
  });

  it("requires a host allowlist and uses dot-delimited suffix matching", async () => {
    expect(() =>
      createJsonResponseSourceFetch({ allowedHostSuffixes: [] }),
    ).toThrow(/non-empty array/u);
    expect(() => createJsonResponseSourceFetch()).toThrow(
      /allowedHostSuffixes required/u,
    );

    let called = false;
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: [".example.test"],
      fetchImpl: async () => {
        called = true;
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    const disallowedUrls = [
      "https://evilexample.test/orders?token=first-secret",
      "https://example.test.evil.test/orders?token=second-secret",
    ];
    for (const url of disallowedUrls) {
      let failure = null;
      try {
        await sourceFetch(url);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "SOURCE_HOST_NOT_ALLOWED" });
      expect(String(failure)).not.toContain(url);
      expect(String(failure)).not.toContain(new URL(url).hostname);
    }
    expect(called).toBe(false);
  });

  it("restricts the Response compatibility layer to default protocol ports", async () => {
    const requested = [];
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async (url) => {
        requested.push(String(url));
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    await expect(
      sourceFetch("https://api.example.test:443/orders"),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      sourceFetch("https://api.example.test:8443/orders"),
    ).rejects.toMatchObject({ code: "SOURCE_PORT_NOT_ALLOWED" });
    expect(requested).toEqual(["https://api.example.test/orders"]);

    const httpFetch = createJsonResponseSourceFetch({
      allowHttp: true,
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async (url) => {
        requested.push(String(url));
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    await expect(
      httpFetch("http://api.example.test:80/orders"),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      httpFetch("http://api.example.test:8080/orders"),
    ).rejects.toMatchObject({ code: "SOURCE_PORT_NOT_ALLOWED" });
    expect(requested).toEqual([
      "https://api.example.test/orders",
      "http://api.example.test/orders",
    ]);
  });

  it("sanitizes invalid redirects and never follows a cross-origin redirect with Cookie", async () => {
    const locationSecret = "invalid-location-secret";
    const baseSecret = "base-query-secret";
    let invalidBodyCancelled = false;
    const invalidRedirectFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("redirect"));
            },
            cancel() {
              invalidBodyCancelled = true;
            },
          }),
          {
            status: 302,
            headers: { location: `https://[${locationSecret}` },
          },
        ),
    });

    let invalidFailure = null;
    try {
      await invalidRedirectFetch(
        `https://api.example.test/start?token=${baseSecret}`,
      );
    } catch (error) {
      invalidFailure = error;
    }
    expect(invalidFailure).toMatchObject({
      code: "SOURCE_REDIRECT_INVALID",
      status: 302,
    });
    expect(invalidFailure).not.toHaveProperty("cause");
    expect(invalidFailure).not.toHaveProperty("input");
    expect(invalidFailure).not.toHaveProperty("base");
    expect(inspect(invalidFailure)).not.toContain(locationSecret);
    expect(inspect(invalidFailure)).not.toContain(baseSecret);
    expect(invalidBodyCancelled).toBe(true);

    const requests = [];
    const crossOriginFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async (url, init) => {
        requests.push({
          cookie: init.headers.get("cookie"),
          url: String(url),
        });
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://collector.example.test/orders",
          },
        });
      },
    });
    await expect(
      crossOriginFetch("https://api.example.test/start", {
        headers: { cookie: "sid=runtime-secret" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REDIRECT_NOT_ALLOWED" });
    expect(requests).toEqual([
      {
        cookie: "sid=runtime-secret",
        url: "https://api.example.test/start",
      },
    ]);
  });

  it("rejects HTTP and credential-bearing URLs without echoing credentials", async () => {
    let called = false;
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      fetchImpl: async () => {
        called = true;
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    await expect(sourceFetch("http://api.example.test/orders")).rejects.toThrow(
      /HTTPS/u,
    );

    let failure = null;
    try {
      await sourceFetch(
        "https://runtime-user:top-secret@api.example.test/orders",
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/credential-free/u);
    expect(String(failure)).not.toContain("runtime-user");
    expect(String(failure)).not.toContain("top-secret");
    expect(called).toBe(false);
  });

  it("preserves bounded non-2xx Responses while keeping successful responses strict", async () => {
    let responseBody = "<html>login</html>";
    let responseStatus = 200;
    let called = 0;
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      maxCookieBytes: 4,
      maxResponseBytes: 24,
      fetchImpl: async () => {
        called += 1;
        return new Response(responseBody, {
          status: responseStatus,
          headers: { "content-type": "text/html" },
        });
      },
    });

    await expect(
      sourceFetch("https://api.example.test/orders", {
        headers: { cookie: "sid=secret" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_COOKIE_TOO_LARGE" });
    expect(called).toBe(0);

    await expect(
      sourceFetch("https://api.example.test/orders"),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_NOT_JSON" });

    responseStatus = 403;
    responseBody = "denied";
    const denied = await sourceFetch("https://api.example.test/orders");
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("denied");

    responseStatus = 401;
    responseBody = "";
    const emptyDenied = await sourceFetch("https://api.example.test/orders");
    expect(emptyDenied.ok).toBe(false);
    expect(emptyDenied.status).toBe(401);
    expect(emptyDenied.body).toBeNull();
    expect(await emptyDenied.text()).toBe("");

    responseStatus = 429;
    responseBody = '{"orders":[1,2,3,4,5,6,7,8]}';
    await expect(
      sourceFetch("https://api.example.test/orders"),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_TOO_LARGE" });
  });

  it("forwards caller aborts through the Response compatibility layer", async () => {
    let requestStarted;
    const started = new Promise((resolve) => {
      requestStarted = resolve;
    });
    const sourceFetch = createJsonResponseSourceFetch({
      allowedHostSuffixes: ["example.test"],
      timeoutMs: 1_000,
      fetchImpl: async (_url, init) =>
        await new Promise((_resolve, reject) => {
          requestStarted();
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        }),
    });
    const controller = new AbortController();
    const reason = new Error("collector cancelled");
    const pending = sourceFetch("https://api.example.test/orders", {
      signal: controller.signal,
    });
    await started;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
