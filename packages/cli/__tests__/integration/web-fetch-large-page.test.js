import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  mapAgentEvent,
  createTurnState,
} from "../../../vscode-extension/src/chat/chat-events.js";

const searchConfig = vi.hoisted(() => ({}));
vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: () => process.cwd(),
  loadProjectConfig: () => ({
    webFetch: { allowPrivateHosts: true },
    webSearch: searchConfig,
  }),
  isInsideProject: () => true,
}));

describe("large pages through agent dispatch and IDE result mapping", () => {
  let server;
  let url;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith("/search?")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                title: "Large source",
                url,
                content: "A searchable large document",
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h1>Large page</h1><p>${"content ".repeat(700_000)}</p>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    Object.assign(searchConfig, { provider: "searxng", instanceUrl: url });
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("discovers a source by keywords before reading its large webpage", async () => {
    const found = await executeTool(
      "web_search",
      { query: "large source", maxSnippetChars: 10 },
      { cwd: process.cwd() },
    );
    expect(found.error).toBeUndefined();
    expect(found.provider).toBe("searxng");
    expect(found.results[0].snippet).toHaveLength(10);
    const page = await executeTool(
      "web_fetch",
      { url: found.results[0].url, maxChars: 12 },
      { cwd: process.cwd() },
    );
    expect(page.content).toBe("# Large page");
    expect(page.snapshotId).toBeTruthy();
  });

  it("passes the output limit through and reads a page above the old 2 MB cap", async () => {
    const result = await executeTool(
      "web_fetch",
      { url, maxChars: 12 },
      {
        cwd: process.cwd(),
      },
    );
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      statusCode: 200,
      content: "# Large page",
      truncated: true,
      maxChars: 12,
    });
    expect(result.bytes).toBeGreaterThan(5_000_000);
    const event = mapAgentEvent(
      {
        type: "tool_result",
        tool: "web_fetch",
        is_error: !!result.error,
        result,
      },
      createTurnState(),
    );
    expect(event.isError).toBe(false);
  });

  it("returns a marked prefix by default and surfaces strict size failures", async () => {
    const args = { url, maxBytes: 1000, maxChars: 50 };
    const partial = await executeTool("web_fetch", args, {
      cwd: process.cwd(),
    });
    expect(partial.error).toBeUndefined();
    expect(partial).toMatchObject({ downloadTruncated: true, truncated: true });
    expect(partial.content).toContain("# Large page");
    expect(partial.content.length).toBeLessThanOrEqual(50);

    const result = await executeTool(
      "web_fetch",
      { ...args, onOverflow: "error" },
      {
        cwd: process.cwd(),
      },
    );
    expect(result.code).toBe("ERR_RESPONSE_TOO_LARGE");
    const event = mapAgentEvent(
      {
        type: "tool_result",
        tool: "web_fetch",
        is_error: true,
        result,
      },
      createTurnState(),
    );
    expect(event).toMatchObject({
      isError: true,
      errorCode: "ERR_RESPONSE_TOO_LARGE",
      error: expect.stringContaining("1000"),
      hint: expect.stringContaining("maxChars"),
    });
  });

  it("downloads once and reads all remaining chunks after the origin goes offline", async () => {
    const body = "已下载的正文🙂\n".repeat(1000);
    let requests = 0;
    const origin = http.createServer((_req, res) => {
      requests++;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(body);
    });
    await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const offlineUrl = `http://127.0.0.1:${origin.address().port}/`;
    const context = { cwd: process.cwd() };
    let page;
    try {
      page = await executeTool(
        "web_fetch",
        { url: offlineUrl, maxChars: 101 },
        context,
      );
    } finally {
      origin.closeAllConnections();
      await new Promise((resolve) => origin.close(resolve));
    }
    expect(page.error).toBeUndefined();
    const snapshotId = page.snapshotId;
    expect(snapshotId).toBeTruthy();
    const search = await executeTool(
      "web_fetch",
      {
        url: offlineUrl,
        snapshotId,
        query: "正文🙂",
        maxMatches: 3,
      },
      context,
    );
    expect(search.error).toBeUndefined();
    expect(search.matches).toHaveLength(3);
    expect(search.cached).toBe(true);
    const focused = await executeTool(
      "web_fetch",
      search.matches[1].nextRead,
      context,
    );
    expect(focused.error).toBeUndefined();
    expect(focused.content).toContain("正文🙂");
    let content = page.content;
    for (let n = 0; page.hasMore && n < 200; n++) {
      page = await executeTool(
        "web_fetch",
        {
          url: offlineUrl,
          snapshotId,
          offset: page.nextOffset,
          maxChars: 101,
        },
        context,
      );
      expect(page.error).toBeUndefined();
      expect(page.cached).toBe(true);
      content += page.content;
    }
    expect(page.hasMore).toBe(false);
    expect(content).toBe(body);
    expect(requests).toBe(1);
  });
});
