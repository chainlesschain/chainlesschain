import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { HostResourceBudget } from "../../src/lib/host-resource-budget.js";
import {
  isPrivateHost,
  checkAllowed,
  htmlToMarkdown,
  webFetch,
  makeSafeLookup,
  _deps,
} from "../../src/lib/web-fetch.js";

describe("web-fetch — makeSafeLookup() DNS-SSRF guard", () => {
  // Fake resolver: maps a hostname → addresses, mimicking dns.lookup({all:true}).
  function fakeLookup(map) {
    return (hostname, _opts, cb) => {
      const addrs = map[hostname];
      if (!addrs) return cb(new Error("ENOTFOUND"));
      cb(null, addrs);
    };
  }

  it("rejects a public-looking host that resolves to a private/metadata IP", () => {
    const lookup = makeSafeLookup(false, {
      lookup: fakeLookup({
        "evil.example.com": [{ address: "169.254.169.254", family: 4 }],
      }),
    });
    let err = null;
    lookup("evil.example.com", {}, (e) => (err = e));
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/private\/loopback resolved IP blocked/);
  });

  it("rejects if ANY resolved address is private (mixed records)", () => {
    const lookup = makeSafeLookup(false, {
      lookup: fakeLookup({
        "rebind.example.com": [
          { address: "93.184.216.34", family: 4 }, // public
          { address: "127.0.0.1", family: 4 }, // private
        ],
      }),
    });
    let err = null;
    lookup("rebind.example.com", {}, (e) => (err = e));
    expect(err).toBeTruthy();
  });

  it("allows a host that resolves only to public IPs", () => {
    const lookup = makeSafeLookup(false, {
      lookup: fakeLookup({
        "ok.example.com": [{ address: "93.184.216.34", family: 4 }],
      }),
    });
    let result = null;
    lookup("ok.example.com", {}, (e, addr, fam) => (result = { e, addr, fam }));
    expect(result.e).toBeFalsy();
    expect(result.addr).toBe("93.184.216.34");
    expect(result.fam).toBe(4);
  });

  it("honors allowPrivateHosts=true (opt-out)", () => {
    const lookup = makeSafeLookup(true, {
      lookup: fakeLookup({
        "internal.corp": [{ address: "10.0.0.5", family: 4 }],
      }),
    });
    let result = null;
    lookup("internal.corp", {}, (e, addr) => (result = { e, addr }));
    expect(result.e).toBeFalsy();
    expect(result.addr).toBe("10.0.0.5");
  });

  it("returns the full validated array for Node's autoSelectFamily lookup", () => {
    const addresses = [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ];
    const lookup = makeSafeLookup(false, {
      lookup: fakeLookup({ "ok.example.com": addresses }),
    });
    let result;
    lookup("ok.example.com", { all: true }, (error, value) => {
      result = { error, value };
    });
    expect(result).toEqual({ error: null, value: addresses });
  });

  it("propagates a resolution failure", () => {
    const lookup = makeSafeLookup(false, { lookup: fakeLookup({}) });
    let err = null;
    lookup("nope.example.com", {}, (e) => (err = e));
    expect(err).toBeTruthy();
  });
});

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
      } else if (req.url === "/denied") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Forbidden" }));
      } else if (req.url === "/busy") {
        res.writeHead(429, { "Retry-After": "60" });
        res.end("try later");
      } else if (req.url === "/slow") {
        // Keep producing data: a socket idle timeout alone never fires.
        res.writeHead(200);
        const timer = setInterval(() => res.write("."), 10);
        res.on("close", () => clearInterval(timer));
      } else if (req.url === "/large") {
        res.end("x".repeat(2000));
      } else if (req.url === "/large-page") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><script>${"x".repeat(5_000_000)}</script><h1>Large page</h1><p>${"正文🙂".repeat(10_000)}</p></html>`,
        );
      } else if (req.url === "/over-default-limit") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("x".repeat(12_000_000));
      } else if (req.url === "/json-string") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify("a complete JSON string"));
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

  it("fetches through a hostname using Node's multi-address connection path", async () => {
    // Node 22.12 on Windows can resolve localhost to IPv6 only. Keep the real
    // HTTP connection and safe lookup adapter, but match DNS to our IPv4 fixture.
    const originalLookup = _deps.lookup;
    const lookups = [];
    _deps.lookup = (hostname, options, callback) => {
      lookups.push({ hostname, all: options.all });
      queueMicrotask(() =>
        callback(null, [{ address: "127.0.0.1", family: 4 }]),
      );
    };
    try {
      const result = await webFetch(`http://web-fetch.test:${port}/hello`, {
        config: { allowPrivateHosts: true },
      });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain("# Hi");
      expect(lookups).toEqual([{ hostname: "web-fetch.test", all: true }]);
    } finally {
      _deps.lookup = originalLookup;
    }
  });

  it("classifies HTTP failure before attempting JSON parsing", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/missing`, {
      format: "json",
      config: { allowPrivateHosts: true },
    });
    expect(result).toMatchObject({
      statusCode: 404,
      code: "ERR_HTTP_STATUS",
      retryable: false,
    });
    expect(result.error).toContain("404");
  });

  it("reports authorization failures without suggesting an identical retry", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/denied`, {
      config: { allowPrivateHosts: true },
    });
    expect(result).toMatchObject({ statusCode: 403, retryable: false });
    expect(result.error).toContain("403");
    expect(result.hint).toMatch(/access|auth/i);
  });

  it("returns rate-limit backoff information", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/busy`, {
      config: { allowPrivateHosts: true },
    });
    expect(result).toMatchObject({
      statusCode: 429,
      retryable: true,
      retryAfter: "60",
    });
  });

  it("bounds the total request duration even when data keeps arriving", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/slow`, {
      timeout: 100,
      config: { allowPrivateHosts: true },
    });
    expect(result).toMatchObject({ code: "ETIMEDOUT", retryable: true });
  }, 3000);

  it("returns a structured size failure", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/large`, {
      maxBytes: 100,
      onOverflow: "error",
      config: { allowPrivateHosts: true },
    });
    expect(result).toMatchObject({
      code: "ERR_RESPONSE_TOO_LARGE",
      retryable: false,
      maxBytes: 100,
      suggestedMaxBytes: 10_000_000,
    });
    expect(result.receivedBytes).toBeGreaterThan(100);
    expect(result.hint).toContain("maxChars");
  });

  it("reads a 5 MB HTML page with the defaults and bounds extracted text", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/large-page`, {
      config: { allowPrivateHosts: true },
    });
    expect(result.error).toBeUndefined();
    expect(result.statusCode).toBe(200);
    expect(result.bytes).toBeGreaterThan(5_000_000);
    expect(result.content).toMatch(/^# Large page/);
    expect(result.content).not.toContain("xxx");
    expect(result.content.length).toBeLessThanOrEqual(20_000);
    expect(result.totalChars).toBeGreaterThan(20_000);
    expect(result.truncated).toBe(true);
  });

  it("uses maxChars after extraction without lowering the raw download budget", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/large-page`, {
      maxChars: 12,
      config: { allowPrivateHosts: true },
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toBe("# Large page");
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBeGreaterThan(40_000);
  });

  it("honors explicit download limits and supports pages above 10 MB when raised", async () => {
    const url = `http://127.0.0.1:${port}/over-default-limit`;
    const config = { allowPrivateHosts: true };
    const partial = await webFetch(url, { config, maxChars: 100 });
    expect(partial.error).toBeUndefined();
    expect(partial).toMatchObject({
      bytes: 10_000_000,
      downloadTruncated: true,
      truncated: true,
      maxBytes: 10_000_000,
      content: "x".repeat(100),
    });
    expect(partial.hint).toMatch(/increase maxBytes/i);
    const blocked = await webFetch(url, { config, onOverflow: "error" });
    expect(blocked).toMatchObject({
      code: "ERR_RESPONSE_TOO_LARGE",
      maxBytes: 10_000_000,
    });
    const result = await webFetch(url, {
      config,
      maxBytes: 13_000_000,
      maxChars: 100,
    });
    expect(result.error).toBeUndefined();
    expect(result.bytes).toBe(12_000_000);
    expect(result.totalChars).toBe(12_000_000);
    expect(result.content).toBe("x".repeat(100));
    expect(result.truncated).toBe(true);
    expect(result.downloadTruncated).toBeUndefined();
  });

  it("keeps short-output cache entries separate from requests for more text", async () => {
    const hostResourceBudget = new HostResourceBudget();
    const options = {
      config: { allowPrivateHosts: true },
      hostResourceBudget,
      maxChars: 1,
    };
    const url = `http://127.0.0.1:${port}/hello`;
    const short = await webFetch(url, options);
    const cached = await webFetch(url, options);
    const longer = await webFetch(url, { ...options, maxChars: 100 });
    expect(short).toMatchObject({ content: "#", truncated: true });
    expect(cached).toMatchObject({
      content: "#",
      truncated: true,
      cached: true,
    });
    expect(longer.cached).toBeUndefined();
    expect(longer).toMatchObject({
      content: "# Hi\n\nWorld",
      truncated: false,
    });
  });

  it.each(["text", "html"])(
    "bounds %s output without a fetch failure",
    async (format) => {
      const result = await webFetch(`http://127.0.0.1:${port}/hello`, {
        format,
        maxChars: 3,
        config: { allowPrivateHosts: true },
      });
      expect(result.error).toBeUndefined();
      expect(result.content).toHaveLength(3);
      expect(result.truncated).toBe(true);
    },
  );

  it.each(["/json", "/json-string"])(
    "preserves JSON values with a small maxChars: %s",
    async (endpoint) => {
      const result = await webFetch(`http://127.0.0.1:${port}${endpoint}`, {
        format: "json",
        maxChars: 1,
        config: { allowPrivateHosts: true },
      });
      expect(result.error).toBeUndefined();
      expect(result.content).toEqual(
        endpoint === "/json" ? { ok: true, n: 42 } : "a complete JSON string",
      );
      expect(result.truncated).toBeUndefined();
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, "100"])(
    "rejects invalid maxChars before I/O: %s",
    async (maxChars) => {
      const result = await webFetch("https://example.com/", { maxChars });
      expect(result.code).toBe("ERR_FETCH_OPTIONS");
    },
  );

  it("never caches an incomplete download as a complete page", async () => {
    const hostResourceBudget = new HostResourceBudget();
    const options = {
      config: { allowPrivateHosts: true },
      hostResourceBudget,
      maxBytes: 8,
    };
    const url = `http://127.0.0.1:${port}/hello`;
    const partial = await webFetch(url, options);
    expect(partial.downloadTruncated).toBe(true);
    expect(hostResourceBudget.status().webFetchCache.entries).toBe(0);
    const strict = await webFetch(url, { ...options, onOverflow: "error" });
    expect(strict.code).toBe("ERR_RESPONSE_TOO_LARGE");
    const full = await webFetch(url, { ...options, maxBytes: 1000 });
    expect(full).toMatchObject({ truncated: false, content: "# Hi\n\nWorld" });
  });

  it("drops an unfinished script when a page is cut off in its markup", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/large-page`, {
      config: { allowPrivateHosts: true },
      maxBytes: 1000,
    });
    expect(result.error).toBeUndefined();
    expect(result.downloadTruncated).toBe(true);
    expect(result.content).toBe("");
    expect(result.hint).toContain("not the complete page");
  });

  it("fails explicitly for oversized JSON instead of returning a broken value", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/json`, {
      config: { allowPrivateHosts: true },
      format: "json",
      maxBytes: 5,
    });
    expect(result.code).toBe("ERR_RESPONSE_TOO_LARGE");
    expect(result.content).toBeUndefined();
  });

  it("does not report a download truncated when it exactly fits the limit", async () => {
    const result = await webFetch(`http://127.0.0.1:${port}/large`, {
      config: { allowPrivateHosts: true },
      maxBytes: 2000,
      maxChars: 2000,
    });
    expect(result).toMatchObject({ bytes: 2000, truncated: false });
    expect(result.downloadTruncated).toBeUndefined();
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
