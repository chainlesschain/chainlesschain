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
import dns from "node:dns";
import {
  evaluateNetworkAccess,
  isPrivateHost,
} from "./sandbox-network-policy.js";

/** Promisified `dns.lookup` returning ALL resolved addresses. */
function defaultLookup(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addrs) =>
      err ? reject(err) : resolve(addrs),
    );
  });
}

/**
 * DNS-rebinding / SSRF-by-resolution guard. The domain policy is decided by
 * NAME, but a public-looking name can RESOLVE to a private / metadata IP
 * (`rebind.evil.com → 127.0.0.1` / `169.254.169.254`) and the name check would
 * never see it — a classic rebinding bypass (Phase 1 acceptance "DNS 重绑定有
 * 安全测试"). After a wildcard/permissive allow, resolve the host and reject if
 * ANY address is private (unless `allowPrivate`). Fail CLOSED on an unresolvable
 * host. On success, pin the connection to the exact validated address so a
 * second resolution at connect time can't rebind to a different (private) IP.
 * A `specific` allow (exact/subdomain name the user vetted) is exempt — the
 * caller skips this — so intentional internal-name allowlisting still works.
 * @returns {Promise<{ok:boolean, ip?:string, reason?:string}>}
 */
async function guardResolvedTarget(host, policy, lookup) {
  let addrs;
  try {
    addrs = await lookup(host);
  } catch (e) {
    return {
      ok: false,
      reason: `unresolvable host (fail-closed): ${e.code || e.message}`,
    };
  }
  const list = Array.isArray(addrs) ? addrs : addrs ? [addrs] : [];
  if (list.length === 0) {
    return { ok: false, reason: "host resolved to no addresses (fail-closed)" };
  }
  for (const a of list) {
    const ip = typeof a === "string" ? a : a && a.address;
    if (ip && isPrivateHost(ip) && !policy.allowPrivate) {
      return {
        ok: false,
        reason: `dns-rebinding: ${host} resolves to private ${ip}`,
      };
    }
  }
  const first = list[0];
  return { ok: true, ip: typeof first === "string" ? first : first.address };
}

/**
 * Parse a CONNECT request target ("host:port") into `{ host, port }`. A naive
 * `split(":")` mangles IPv6 literals — `[2001:db8::1]:8443` would yield host
 * `"[2001"` and a NaN port that silently defaults to 443, so even an IP-pinned
 * tunnel connects to the WRONG port (and, when unpinned, the wrong host). Handle
 * the bracketed-IPv6, bare-IPv6, and `name[:port]` forms explicitly. Port
 * defaults to 443 (the CONNECT/HTTPS default).
 */
export function parseConnectTarget(target) {
  const s = String(target == null ? "" : target).trim();
  const toPort = (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 443;
  };
  // Bracketed IPv6: "[::1]" or "[::1]:8443"
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end > 0) {
      const host = s.slice(1, end);
      const rest = s.slice(end + 1); // "" or ":8443"
      return { host, port: rest.startsWith(":") ? toPort(rest.slice(1)) : 443 };
    }
    // malformed bracket — fall through to the generic handling
  }
  // Bare IPv6 literal (2+ colons, no brackets) → no port component to split off.
  if ((s.match(/:/g) || []).length > 1) {
    return { host: s, port: 443 };
  }
  // "name:port" (rsplit on the single colon) or bare "name".
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    return { host: s.slice(0, idx), port: toPort(s.slice(idx + 1)) };
  }
  return { host: s, port: 443 };
}

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

  const lookup = opts.lookup || defaultLookup;
  const rebindGuard = opts.checkDnsRebinding !== false; // on by default

  // Second gate: after a NAME-based allow, re-check the RESOLVED address for
  // DNS rebinding (unless the allow was `specific` — a name the user vetted —
  // or the guard is disabled). Returns the verdict to ACT on plus `ip`, the
  // exact address to pin the connection to (null → connect by the original
  // name). When the resolved IP is private the name-based allow is overturned:
  // fix the counters and re-notify observers with the block reason.
  const guard = async (verdict, kind) => {
    if (!verdict.allowed || verdict.specific || !rebindGuard) {
      return { verdict, ip: null };
    }
    const res = await guardResolvedTarget(verdict.host, policy, lookup);
    if (res.ok) return { verdict, ip: res.ip };
    state.allowed -= 1;
    state.blocked += 1;
    const blocked = { allowed: false, host: verdict.host, reason: res.reason };
    if (typeof opts.onDecision === "function") {
      try {
        opts.onDecision({ kind, target: verdict.host, ...blocked });
      } catch {
        /* observation is best-effort */
      }
    }
    return { verdict: blocked, ip: null };
  };

  const server = http.createServer(async (req, res) => {
    try {
      // A forward-proxy request carries the absolute URL in the request line.
      const { verdict, ip } = await guard(decide(req.url, "http"), "http");
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
          hostname: ip || u.hostname, // pin to the validated IP when re-checked
          port: u.port || 80,
          path: `${u.pathname}${u.search}`,
          method: req.method,
          headers: req.headers, // preserves the original Host header
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
    } catch {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "text/plain" });
      res.end("proxy error\n");
    }
  });

  // HTTPS (and any TLS) goes through CONNECT — tunnel only allowed hosts.
  server.on("connect", async (req, clientSocket, head) => {
    try {
      const { verdict, ip } = await guard(
        decide(req.url, "connect"),
        "connect",
      ); // req.url = "host:port"
      if (!verdict.allowed) {
        clientSocket.write(
          "HTTP/1.1 403 Forbidden\r\n" +
            "Content-Type: text/plain\r\n\r\n" +
            `egress blocked: ${verdict.host} — ${verdict.reason}\n`,
        );
        clientSocket.end();
        return;
      }
      // Parse host:port properly (IPv6 literals break a naive split).
      const { host, port } = parseConnectTarget(req.url);
      // Connect to the pinned validated IP so a rebind at connect time can't
      // swap in a private address between our check and the socket.
      const upstream = net.connect(port, ip || host, () => {
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
    } catch {
      try {
        clientSocket.end();
      } catch {
        /* already closed */
      }
    }
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
