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

  it("flags IPv6 loopback/ULA/link-local — bracketed as new URL() returns them", () => {
    // new URL("http://[::1]/").hostname === "[::1]" — the bare ::1 rule was dead
    // without bracket stripping, so IPv6 loopback was silently reachable.
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("[::]")).toBe(true); // unspecified
    expect(isPrivateHost("[fc00::1]")).toBe(true); // ULA
    expect(isPrivateHost("[fdff::1]")).toBe(true); // ULA
    expect(isPrivateHost("[fe80::1]")).toBe(true); // link-local
    expect(isPrivateHost("[febf::1]")).toBe(true); // link-local
  });

  it("flags IPv4-mapped IPv6 loopback/private (new URL hex-normalizes them)", () => {
    // new URL hex-normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1, which would
    // bypass the IPv4 rules without decoding the embedded address.
    expect(isPrivateHost("[::ffff:7f00:1]")).toBe(true); // 127.0.0.1
    expect(isPrivateHost("[::ffff:a00:1]")).toBe(true); // 10.0.0.1
    expect(isPrivateHost("[::ffff:c0a8:101]")).toBe(true); // 192.168.1.1
  });

  it("does not over-block public IPv6 or mapped-public IPv4", () => {
    expect(isPrivateHost("[2606:4700:4700::1111]")).toBe(false);
    expect(isPrivateHost("[::ffff:808:808]")).toBe(false); // 8.8.8.8 mapped
  });

  it("normalizes decimal/integer IPv4 forms via the URL parser", () => {
    // new URL() canonicalizes these, so the dotted-decimal rules catch them.
    expect(isPrivateHost(new URL("http://2130706433/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://0/").hostname)).toBe(true);
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

  it("blocks IPv6 loopback / ULA / mapped-loopback end-to-end", () => {
    expect(checkAllowed("http://[::1]/").allowed).toBe(false);
    expect(checkAllowed("http://[fd00::1]/").allowed).toBe(false);
    expect(checkAllowed("http://[::ffff:127.0.0.1]/").allowed).toBe(false);
    expect(checkAllowed("http://[2606:4700:4700::1111]/").allowed).toBe(true);
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
