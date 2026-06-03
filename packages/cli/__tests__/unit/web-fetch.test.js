import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import {
  isPrivateHost,
  checkAllowed,
  htmlToMarkdown,
  webFetch,
} from "../../src/lib/web-fetch.js";

describe("web-fetch — isPrivateHost()", () => {
  it("flags loopback and RFC1918 hosts", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("accepts public hosts", () => {
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });
});

describe("web-fetch — checkAllowed()", () => {
  it("rejects invalid URLs", () => {
    expect(checkAllowed("not-a-url").allowed).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(checkAllowed("ftp://example.com").allowed).toBe(false);
    expect(checkAllowed("file:///etc/passwd").allowed).toBe(false);
  });

  it("blocks private hosts by default", () => {
    expect(checkAllowed("http://127.0.0.1:8080").allowed).toBe(false);
    expect(checkAllowed("http://localhost").allowed).toBe(false);
  });

  it("allows private hosts when config.allowPrivateHosts is true", () => {
    expect(
      checkAllowed("http://127.0.0.1:8080", { allowPrivateHosts: true })
        .allowed,
    ).toBe(true);
  });

  it("enforces allowedDomains allowlist", () => {
    expect(
      checkAllowed("https://example.com/", { allowedDomains: ["example.com"] })
        .allowed,
    ).toBe(true);
    expect(
      checkAllowed("https://other.com/", { allowedDomains: ["example.com"] })
        .allowed,
    ).toBe(false);
  });

  it("supports *.subdomain wildcard", () => {
    expect(
      checkAllowed("https://api.example.com/", {
        allowedDomains: ["*.example.com"],
      }).allowed,
    ).toBe(true);
  });

  it("defaults to * (allow all public)", () => {
    expect(checkAllowed("https://example.com/").allowed).toBe(true);
  });
});

describe("web-fetch — htmlToMarkdown()", () => {
  it("strips script/style tags", () => {
    const html = "<p>hi</p><script>alert(1)</script><style>x{}</style>";
    expect(htmlToMarkdown(html)).toBe("hi");
  });

  it("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toMatch(/^# Title/);
    expect(htmlToMarkdown("<h3>Sub</h3>")).toMatch(/^### Sub/);
  });

  it("converts links to markdown", () => {
    const html = '<a href="https://example.com">Click</a>';
    expect(htmlToMarkdown(html)).toBe("[Click](https://example.com)");
  });

  it("converts li to bullet", () => {
    expect(htmlToMarkdown("<li>item</li>")).toMatch(/- item/);
  });

  it("decodes common HTML entities", () => {
    expect(htmlToMarkdown("a&nbsp;&amp;&lt;b&gt;")).toBe("a &<b>");
  });

  it("handles empty / non-string", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown(null)).toBe("");
  });

  it("collapses excessive whitespace", () => {
    const input = "<p>a</p>\n\n\n\n\n<p>b</p>";
    expect(htmlToMarkdown(input)).not.toMatch(/\n{3,}/);
  });
});

describe("web-fetch — webFetch() against local server", () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/hello") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Hi</h1><p>World</p>");
      } else if (req.url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, n: 42 }));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/hello" });
        res.end();
      } else if (req.url === "/badjson") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("not json");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("blocks when allowPrivateHosts is false (default)", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/hello`);
    expect(result.error).toMatch(/private/);
  });

  it("fetches markdown when allowed", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/hello`, {
      config: { allowPrivateHosts: true },
    });
    expect(result.statusCode).toBe(200);
    expect(result.format).toBe("markdown");
    expect(result.content).toMatch(/# Hi/);
    expect(result.content).toMatch(/World/);
  });

  it("parses JSON format", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/json`, {
      format: "json",
      config: { allowPrivateHosts: true },
    });
    expect(result.statusCode).toBe(200);
    expect(result.content).toEqual({ ok: true, n: 42 });
  });

  it("returns error on invalid JSON when format=json", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/badjson`, {
      format: "json",
      config: { allowPrivateHosts: true },
    });
    expect(result.error).toMatch(/valid JSON/);
  });

  it("follows redirects", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/redirect`, {
      config: { allowPrivateHosts: true },
    });
    expect(result.statusCode).toBe(200);
    expect(result.content).toMatch(/# Hi/);
  });

  it("returns html format as-is", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/hello`, {
      format: "html",
      config: { allowPrivateHosts: true },
    });
    expect(result.content).toMatch(/<h1>Hi<\/h1>/);
  });
});
