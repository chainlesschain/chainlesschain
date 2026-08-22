import { EventEmitter } from "node:events";
import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  HostResourceBudget,
  HostResourceBudgetError,
} from "../../src/lib/host-resource-budget.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { webFetch } from "../../src/lib/web-fetch.js";
import { _deps as webSearchDeps, webSearch } from "../../src/lib/web-search.js";

function fakeSearchTransport(onRequest) {
  return {
    request(options, callback) {
      const request = new EventEmitter();
      request.write = () => {};
      request.destroy = () => {};
      request.end = () => {
        onRequest(options);
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = { "content-type": "application/json" };
        queueMicrotask(() => {
          callback(response);
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                web: {
                  results: [
                    { title: "one", url: "https://one.test", description: "1" },
                    { title: "two", url: "https://two.test", description: "2" },
                  ],
                },
              }),
            ),
          );
          response.emit("end");
        });
      };
      return request;
    },
  };
}

describe("HostResourceBudget", () => {
  it("bounds renderer, tool, and event backlogs with measurable release slots", () => {
    const sessionBudget = new SessionResourceBudget();
    const budget = new HostResourceBudget({
      sessionBudget,
      maxRendererBacklog: 1,
      maxToolBacklog: 1,
      maxEventBacklog: 1,
    });

    const renderer = budget.admitRenderer();
    const tool = budget.admitTool({ kind: "web-fetch" });
    const event = budget.admitEvent();

    expect(() => budget.admitRenderer()).toThrow(HostResourceBudgetError);
    expect(() => budget.admitTool()).toThrow(/tool-backlog/);
    expect(() => budget.admitEvent()).toThrow(/event-backlog/);
    expect(budget.status()).toMatchObject({
      backlog: {
        renderer: { active: 1, max: 1 },
        tool: { active: 1, max: 1 },
        event: { active: 1, max: 1 },
      },
    });
    expect(sessionBudget.status().activeTools).toBe(1);

    expect(renderer.release()).toBe(true);
    expect(tool.release()).toBe(true);
    expect(event.release()).toBe(true);
    expect(budget.status().backlog).toEqual({
      renderer: { active: 0, max: 1 },
      tool: { active: 0, max: 1 },
      event: { active: 0, max: 1 },
    });
    expect(sessionBudget.status().activeTools).toBe(0);
    sessionBudget.dispose();
  });

  it("uses bounded WebFetch TTL cache without sharing mutable response objects", async () => {
    let now = 10_000;
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ requests }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/data`;
    const budget = new HostResourceBudget({
      now: () => now,
      webFetchTtlMs: 100,
      maxWebFetchEntries: 1,
      maxWebFetchBytes: 4 * 1024,
    });

    try {
      const first = await webFetch(url, {
        format: "json",
        config: { allowPrivateHosts: true },
        hostResourceBudget: budget,
      });
      expect(first.content).toEqual({ requests: 1 });
      first.content.requests = 999;

      const cached = await webFetch(url, {
        format: "json",
        config: { allowPrivateHosts: true },
        hostResourceBudget: budget,
      });
      expect(cached).toMatchObject({ cached: true, content: { requests: 1 } });
      expect(requests).toBe(1);
      expect(budget.status().webFetchCache).toEqual({
        entries: 1,
        bytes: expect.any(Number),
      });

      now += 101;
      const renewed = await webFetch(url, {
        format: "json",
        config: { allowPrivateHosts: true },
        hostResourceBudget: budget,
      });
      expect(renewed.cached).toBeUndefined();
      expect(renewed.content).toEqual({ requests: 2 });
      expect(requests).toBe(2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("fails closed before WebFetch or Web Search I/O when the tool backlog is full", async () => {
    const budget = new HostResourceBudget({ maxToolBacklog: 0 });
    const fetchResult = await webFetch("https://example.com/", {
      hostResourceBudget: budget,
    });
    expect(fetchResult).toMatchObject({
      code: "ERR_HOST_RESOURCE_BUDGET",
      reason: "tool-backlog",
    });

    const originalHttps = webSearchDeps.https;
    const request = () => {
      throw new Error("Web Search network request must not start");
    };
    webSearchDeps.https = { request };
    try {
      const searchResult = await webSearch("budgeted", {
        provider: "brave",
        apiKey: "test-key",
        hostResourceBudget: budget,
      });
      expect(searchResult).toMatchObject({
        code: "ERR_HOST_RESOURCE_BUDGET",
        reason: "tool-backlog",
      });
    } finally {
      webSearchDeps.https = originalHttps;
    }
  });

  it("caps Web Search results at both host and hard safety ceilings", async () => {
    const requests = [];
    const originalHttps = webSearchDeps.https;
    webSearchDeps.https = fakeSearchTransport((request) =>
      requests.push(request),
    );
    try {
      const budget = new HostResourceBudget({ maxWebSearchResults: 1 });
      const result = await webSearch("bounded", {
        provider: "brave",
        apiKey: "test-key",
        maxResults: 9_999,
        hostResourceBudget: budget,
      });
      expect(result.count).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0].path).toContain("count=1");

      const globalCap = await webSearch("hard cap", {
        provider: "brave",
        apiKey: "test-key",
        maxResults: 9_999,
      });
      expect(globalCap.count).toBe(2);
      expect(requests[1].path).toContain("count=20");
    } finally {
      webSearchDeps.https = originalHttps;
    }
  });

  it("threads the host budget through the agent web-tool dispatch", async () => {
    const result = await executeTool(
      "web_fetch",
      { url: "https://example.com/" },
      {
        cwd: process.cwd(),
        hostResourceBudget: new HostResourceBudget({ maxToolBacklog: 0 }),
      },
    );

    expect(result).toMatchObject({
      code: "ERR_HOST_RESOURCE_BUDGET",
      reason: "tool-backlog",
    });
  });
});
