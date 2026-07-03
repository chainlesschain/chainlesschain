/**
 * Integration: the egress-filtering proxy ENFORCES the domain policy against
 * real socket traffic. A denied host is refused before any upstream contact; an
 * allowed host is proxied through to a real local upstream server. Uses only
 * loopback (no external network), so it's deterministic in CI.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
import {
  createEgressProxy,
  proxyEnv,
} from "../../src/lib/sandbox-egress-proxy.js";

let proxy;
let upstream;
afterEach(async () => {
  if (proxy) await proxy.close();
  if (upstream) await new Promise((r) => upstream.close(() => r()));
  proxy = null;
  upstream = null;
});

/** Raw CONNECT to the proxy; resolves with the proxy's HTTP status line. */
function connectVia(port, target) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      if (buf.includes("\r\n")) {
        resolve(buf.split("\r\n")[0]);
        sock.destroy();
      }
    });
    sock.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

/** Plain HTTP GET through the proxy to an absolute URL. */
function getVia(port, absoluteUrl) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "GET", path: absoluteUrl },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: body.trim() }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("sandbox egress proxy", () => {
  it("refuses a CONNECT to a denied host with 403 (no upstream contacted)", async () => {
    proxy = createEgressProxy({ allowedDomains: ["*.github.com"] });
    const { port } = await proxy.listen();
    const statusLine = await connectVia(port, "evil.example.com:443");
    expect(statusLine).toMatch(/403/);
    expect(proxy.blocked).toBe(1);
  });

  it("refuses a CONNECT to a private/metadata host even under a wildcard allow (SSRF)", async () => {
    proxy = createEgressProxy({ allowedDomains: ["*"] });
    const { port } = await proxy.listen();
    const statusLine = await connectVia(port, "169.254.169.254:443");
    expect(statusLine).toMatch(/403/);
  });

  it("proxies an ALLOWED host through to a real upstream", async () => {
    // A local upstream; allow 127.0.0.1 explicitly (private hosts are otherwise
    // blocked by the SSRF guard).
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("UPSTREAM_OK");
    });
    const upPort = await new Promise((r) =>
      upstream.listen(0, "127.0.0.1", () => r(upstream.address().port)),
    );

    proxy = createEgressProxy({ allowedDomains: ["127.0.0.1"] });
    const { port } = await proxy.listen();
    const res = await getVia(port, `http://127.0.0.1:${upPort}/`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("UPSTREAM_OK");
    expect(proxy.allowed).toBeGreaterThanOrEqual(1);
  });

  it("blocks a plain-HTTP request to a denied host with 403", async () => {
    proxy = createEgressProxy({
      allowedDomains: ["*"],
      deniedDomains: ["blocked.example.com"],
    });
    const { port } = await proxy.listen();
    const res = await getVia(port, "http://blocked.example.com/x");
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/egress blocked/);
  });

  it("fires onDecision for each evaluated target", async () => {
    const decisions = [];
    proxy = createEgressProxy(
      { allowedDomains: ["ok.example.com"] },
      { onDecision: (d) => decisions.push(d) },
    );
    const { port } = await proxy.listen();
    await connectVia(port, "ok.example.com:443").catch(() => {});
    await connectVia(port, "no.example.com:443").catch(() => {});
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(
      decisions.some((d) => d.allowed && d.host === "ok.example.com"),
    ).toBe(true);
    expect(
      decisions.some((d) => !d.allowed && d.host === "no.example.com"),
    ).toBe(true);
  });

  it("proxyEnv points every proxy var at the proxy and empties NO_PROXY", () => {
    const env = proxyEnv(8123, "host.docker.internal");
    expect(env.HTTP_PROXY).toBe("http://host.docker.internal:8123");
    expect(env.HTTPS_PROXY).toBe("http://host.docker.internal:8123");
    expect(env.NO_PROXY).toBe("");
  });
});
