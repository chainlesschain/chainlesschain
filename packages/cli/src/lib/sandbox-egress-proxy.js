/**
 * Sandbox egress-filtering proxy (Phase 1 enforcement).
 *
 * The domain policy in `sandbox-network-policy.js` DECIDES whether a host is
 * reachable; this turns that decision into ENFORCEMENT against real
 * subprocesses. A local forward proxy consults `evaluateNetworkAccess` for
 * every request (plain HTTP) and CONNECT tunnel (HTTPS) and refuses the blocked
 * ones. Point a sandboxed process's `HTTP_PROXY`/`HTTPS_PROXY` at it and its
 * `curl`/`npm`/`pip`/`git`/`wget`/`fetch` traffic is filtered.
 *
 * This is a proxy-level control, not a kernel one: a tool that deliberately
 * ignores proxy env can still open a raw socket, so a hard guarantee also needs
 * OS network isolation (Docker `--network`, bwrap netns). But it is fully
 * cross-platform (works on Windows, no root) and closes the common egress path
 * that the domain allow/deny list is actually about.
 */

import http from "node:http";
import net from "node:net";
import { evaluateNetworkAccess } from "./sandbox-network-policy.js";

/**
 * Build the proxy env vars a child process needs to route through the proxy.
 * `NO_PROXY` is intentionally empty so nothing bypasses the filter.
 * @param {number} port
 * @param {string} host  address the CHILD uses to reach the proxy (for a Docker
 *                       container this is `host.docker.internal`, not localhost)
 */
export function proxyEnv(port, host = "127.0.0.1") {
  const url = `http://${host}:${port}`;
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    ALL_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    all_proxy: url,
    NO_PROXY: "",
    no_proxy: "",
  };
}

/**
 * Create (but do not yet listen on) an egress-filtering proxy for a policy.
 * @param {object} policy  { allowedDomains?, deniedDomains?, allowPrivate? }
 * @param {object} [opts]  { onDecision?(info), bindHost? }
 * @returns {{ listen():Promise<{port,env,server}>, close():Promise<void>,
 *             server:import('http').Server, blocked:number, allowed:number }}
 */
export function createEgressProxy(policy = {}, opts = {}) {
  const bindHost = opts.bindHost || "127.0.0.1";
  const state = { blocked: 0, allowed: 0 };
  const decide = (target, kind) => {
    const verdict = evaluateNetworkAccess(target, policy);
    if (verdict.allowed) state.allowed += 1;
    else state.blocked += 1;
    if (typeof opts.onDecision === "function") {
      try {
        opts.onDecision({ kind, target, ...verdict });
      } catch {
        /* observation is best-effort */
      }
    }
    return verdict;
  };

  const server = http.createServer((req, res) => {
    // A forward-proxy request carries the absolute URL in the request line.
    const verdict = decide(req.url, "http");
    if (!verdict.allowed) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(`egress blocked: ${verdict.host} — ${verdict.reason}\n`);
      return;
    }
    let u;
    try {
      u = new URL(req.url);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request target\n");
      return;
    }
    const upstream = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: req.method,
        headers: req.headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "text/plain" });
      res.end("upstream error\n");
    });
    req.pipe(upstream);
  });

  // HTTPS (and any TLS) goes through CONNECT — tunnel only allowed hosts.
  server.on("connect", (req, clientSocket, head) => {
    const verdict = decide(req.url, "connect"); // req.url = "host:port"
    if (!verdict.allowed) {
      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          `egress blocked: ${verdict.host} — ${verdict.reason}\n`,
      );
      clientSocket.end();
      return;
    }
    const [host, portStr] = req.url.split(":");
    const port = parseInt(portStr, 10) || 443;
    const upstream = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      try {
        clientSocket.end();
      } catch {
        /* already closed */
      }
    });
    clientSocket.on("error", () => {
      try {
        upstream.destroy();
      } catch {
        /* already gone */
      }
    });
  });

  return {
    server,
    get blocked() {
      return state.blocked;
    },
    get allowed() {
      return state.allowed;
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, bindHost, () => {
          server.removeListener("error", reject);
          const port = server.address().port;
          resolve({ port, env: proxyEnv(port), server });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
