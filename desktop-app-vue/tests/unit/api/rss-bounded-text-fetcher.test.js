import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const { fetchBoundedText } = require("../../../src/main/api/rss-bounded-text-fetcher.js");
const {
  createRSSFetcherLimits,
} = require("../../../src/main/api/rss-fetcher-boundaries.js");

function createRequest() {
  const request = new EventEmitter();
  request.setTimeout = vi.fn();
  request.destroy = vi.fn();
  return request;
}

function createClient(responseFactory) {
  return {
    get: vi.fn((_url, _options, callback) => {
      const request = createRequest();
      queueMicrotask(() => callback(responseFactory()));
      return request;
    }),
  };
}

const isValidUrl = (value) => /^https?:\/\//.test(value);

describe("bounded RSS text transport", () => {
  it("rejects an oversized declared content length before buffering", async () => {
    const response = new PassThrough();
    response.statusCode = 200;
    response.headers = { "content-length": "17" };
    response.resume = vi.fn();
    const client = createClient(() => response);
    const limits = createRSSFetcherLimits({ maxHtmlResponseBytes: 16 });

    await expect(
      fetchBoundedText({
        url: "http://example.com/",
        maxBytes: 16,
        scope: "rss_html_response",
        limits,
        httpClient: client,
        httpsClient: client,
        isValidUrl,
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "rss_html_response",
      limit: { maxBytes: 16 },
    });
    expect(response.resume).toHaveBeenCalledOnce();
  });

  it("rejects a chunked response as soon as its byte budget is crossed", async () => {
    const client = createClient(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = {};
      queueMicrotask(() => response.end(Buffer.alloc(17)));
      return response;
    });
    const limits = createRSSFetcherLimits({ maxHtmlResponseBytes: 16 });

    await expect(
      fetchBoundedText({
        url: "http://example.com/",
        maxBytes: 16,
        scope: "rss_html_response",
        limits,
        httpClient: client,
        httpsClient: client,
        isValidUrl,
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "rss_html_response",
    });
  });
});
