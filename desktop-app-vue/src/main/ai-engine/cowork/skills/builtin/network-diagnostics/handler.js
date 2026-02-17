/**
 * Network Diagnostics Skill Handler
 *
 * Ping, DNS lookup, port check, port scan, local IP, traceroute, HTTP check.
 * Uses only Node.js built-in modules (dns, net, os, child_process, http, https).
 */

const dns = require("dns");
const net = require("net");
const os = require("os");
const { execSync } = require("child_process");
const http = require("http");
const https = require("https");
const { logger } = require("../../../../../utils/logger.js");

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  const opts = {};
  let action = "help";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--ping" || p === "ping") {
      action = "ping";
      opts.host = parts[++i] || "";
    } else if (p === "--dns" || p === "dns") {
      action = "dns";
      opts.domain = parts[++i] || "";
    } else if (p === "--port" || p === "port") {
      action = "port";
      opts.host = parts[++i] || "";
      opts.port = parseInt(parts[++i], 10) || 0;
    } else if (p === "--ports" || p === "ports") {
      action = "ports";
      opts.host = parts[++i] || "";
    } else if (p === "--ip" || p === "ip") {
      action = "ip";
    } else if (p === "--trace" || p === "trace") {
      action = "trace";
      opts.host = parts[++i] || "";
    } else if (p === "--check" || p === "check") {
      action = "check";
      opts.url = parts[++i] || "";
    } else if (p === "--count") {
      const n = parseInt(parts[++i], 10);
      if (n > 0 && n <= 100) {
        opts.count = n;
      }
    } else if (p === "--type") {
      opts.type = (parts[++i] || "A").toUpperCase();
    } else if (p === "--range") {
      opts.range = parts[++i] || "";
    }
  }
  return { action, opts };
}

function runCmd(cmd, timeout = 30000) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    return e.stdout ? e.stdout.toString().trim() : null;
  }
}

function checkPort(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) {
        return;
      }
      done = true;
      sock.destroy();
      resolve({ port, open });
    };
    sock.setTimeout(timeout);
    sock.on("connect", () => finish(true));
    sock.on("timeout", () => finish(false));
    sock.on("error", () => finish(false));
    sock.connect(port, host);
  });
}

async function handlePing(opts) {
  const host = opts.host;
  if (!host) {
    return {
      success: false,
      result: null,
      message: "Usage: --ping <host> [--count <n>]",
    };
  }
  const count = opts.count || 4;
  const isWin = os.platform() === "win32";
  const cmd = isWin ? `ping -n ${count} ${host}` : `ping -c ${count} ${host}`;
  logger.info(`[network-diagnostics] Ping: ${cmd}`);
  const output = runCmd(cmd, 30000);
  if (!output) {
    return {
      success: false,
      result: { host, reachable: false },
      message: `Ping ${host}: unreachable`,
    };
  }

  const times = [];
  const re = isWin
    ? /[=<](\d+(?:\.\d+)?)ms/gi
    : /time[=<](\d+(?:\.\d+)?)\s*ms/gi;
  let m;
  while ((m = re.exec(output)) !== null) {
    times.push(parseFloat(m[1]));
  }
  const lossM = output.match(/(\d+)%\s*(packet\s*)?loss/i);
  const loss = lossM ? parseInt(lossM[1], 10) : null;
  const recvM = output.match(
    isWin ? /Received\s*=\s*(\d+)/i : /(\d+)\s+(packets?\s+)?received/i,
  );
  const received = recvM ? parseInt(recvM[1], 10) : times.length;
  const avg = times.length
    ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)
    : null;
  const min = times.length ? Math.min(...times).toFixed(2) : null;
  const max = times.length ? Math.max(...times).toFixed(2) : null;

  const info = {
    host,
    transmitted: count,
    received,
    packetLoss: loss !== null ? `${loss}%` : "unknown",
    times,
    min: min && `${min}ms`,
    avg: avg && `${avg}ms`,
    max: max && `${max}ms`,
    reachable: received > 0,
  };
  const msg = [
    `## Ping ${host}`,
    `**Packets**: ${count} sent, ${received} received${loss !== null ? `, ${loss}% loss` : ""}`,
    times.length
      ? `**RTT**: min=${min}ms, avg=${avg}ms, max=${max}ms`
      : "**RTT**: No responses",
  ];
  return { success: true, result: info, message: msg.join("\n") };
}

async function handleDns(opts) {
  const domain = opts.domain;
  if (!domain) {
    return {
      success: false,
      result: null,
      message: "Usage: --dns <domain> [--type A|AAAA|MX|TXT|NS|CNAME|SOA]",
    };
  }
  const type = opts.type || "A";
  const resolver = new dns.promises.Resolver();
  logger.info(`[network-diagnostics] DNS: ${domain} type=${type}`);
  try {
    let records;
    switch (type) {
      case "A":
        records = await resolver.resolve4(domain);
        break;
      case "AAAA":
        records = await resolver.resolve6(domain);
        break;
      case "MX":
        records = (await resolver.resolveMx(domain))
          .sort((a, b) => a.priority - b.priority)
          .map((r) => `${r.priority} ${r.exchange}`);
        break;
      case "TXT":
        records = (await resolver.resolveTxt(domain)).map((r) => r.join(""));
        break;
      case "NS":
        records = await resolver.resolveNs(domain);
        break;
      case "CNAME":
        records = await resolver.resolveCname(domain);
        break;
      case "SOA": {
        const s = await resolver.resolveSoa(domain);
        records = [
          `nsname=${s.nsname} hostmaster=${s.hostmaster} serial=${s.serial}`,
        ];
        break;
      }
      default:
        return {
          success: false,
          result: null,
          message: `Unsupported type: ${type}. Use A|AAAA|MX|TXT|NS|CNAME|SOA`,
        };
    }
    const info = { domain, type, records };
    const msg = [
      `## DNS: ${domain} (${type})`,
      `**Records** (${records.length}):`,
      ...records.map((r) => `  ${r}`),
    ];
    return { success: true, result: info, message: msg.join("\n") };
  } catch (e) {
    return {
      success: false,
      result: { domain, type, error: e.code || e.message },
      message: `DNS failed: ${domain} (${type}): ${e.code || e.message}`,
    };
  }
}

async function handlePort(opts) {
  const { host, port } = opts;
  if (!host || !port || port < 1 || port > 65535) {
    return {
      success: false,
      result: null,
      message: "Usage: --port <host> <port>",
    };
  }
  logger.info(`[network-diagnostics] Port check: ${host}:${port}`);
  const r = await checkPort(host, port, 5000);
  const status = r.open ? "OPEN" : "CLOSED";
  return {
    success: true,
    result: { host, port, open: r.open, status },
    message: `## Port ${host}:${port}\n**Status**: ${status}`,
  };
}

async function handlePortScan(opts) {
  const { host, range } = opts;
  if (!host || !range) {
    return {
      success: false,
      result: null,
      message: "Usage: --ports <host> --range <start>-<end> (max 100)",
    };
  }
  const [s, e] = range.split("-").map(Number);
  if (isNaN(s) || isNaN(e) || s < 1 || e > 65535 || s > e) {
    return {
      success: false,
      result: null,
      message: "Invalid range. Format: <start>-<end>",
    };
  }
  if (e - s + 1 > 100) {
    return {
      success: false,
      result: null,
      message: `Range too large (${e - s + 1}). Max 100 ports.`,
    };
  }
  logger.info(`[network-diagnostics] Port scan: ${host} ${s}-${e}`);
  const results = await Promise.all(
    Array.from({ length: e - s + 1 }, (_, i) => checkPort(host, s + i, 3000)),
  );
  const open = results.filter((r) => r.open);
  const info = {
    host,
    rangeStart: s,
    rangeEnd: e,
    totalScanned: e - s + 1,
    openCount: open.length,
    openPorts: open.map((r) => r.port),
  };
  const lines = open.length
    ? open.map((r) => `  ${r.port} OPEN`).join("\n")
    : "  None";
  return {
    success: true,
    result: info,
    message: [
      `## Port Scan: ${host} (${s}-${e})`,
      `**Scanned**: ${e - s + 1}  **Open**: ${open.length}`,
      "",
      lines,
    ].join("\n"),
  };
}

async function handleIp() {
  const ifaces = os.networkInterfaces();
  const result = [],
    extV4 = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    const entries = (addrs || []).map((a) => ({
      address: a.address,
      family: a.family,
      netmask: a.netmask,
      mac: a.mac,
      internal: a.internal,
    }));
    result.push({ name, addresses: entries });
    for (const a of entries) {
      if (!a.internal && a.family === "IPv4") {
        extV4.push({ iface: name, address: a.address });
      }
    }
  }
  const info = {
    hostname: os.hostname(),
    interfaces: result,
    externalIPv4: extV4,
  };
  const ifLines = result
    .map(
      (i) =>
        `  **${i.name}**: ${i.addresses.map((a) => `${a.family}=${a.address}`).join(", ")}`,
    )
    .join("\n");
  const primary = extV4.length
    ? extV4.map((e) => `  ${e.iface}: ${e.address}`).join("\n")
    : "  No external IPv4";
  return {
    success: true,
    result: info,
    message: [
      `## Local IPs`,
      `**Hostname**: ${os.hostname()}`,
      "",
      "### Primary IPv4",
      primary,
      "",
      "### All Interfaces",
      ifLines,
    ].join("\n"),
  };
}

async function handleTrace(opts) {
  const host = opts.host;
  if (!host) {
    return { success: false, result: null, message: "Usage: --trace <host>" };
  }
  const isWin = os.platform() === "win32";
  const cmd = isWin
    ? `tracert -d -w 3000 ${host}`
    : `traceroute -n -w 3 ${host}`;
  logger.info(`[network-diagnostics] Traceroute: ${cmd}`);
  const output = runCmd(cmd, 60000);
  if (!output) {
    return {
      success: false,
      result: { host, hops: [] },
      message: `Traceroute to ${host} failed`,
    };
  }
  const hops = [];
  for (const line of output.split("\n")) {
    const hm = line.match(/^\s*(\d+)\s+/);
    if (!hm) {
      continue;
    }
    const hopNum = parseInt(hm[1], 10);
    const ipM = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const times = [];
    const tr = /(\d+(?:\.\d+)?)\s*ms/gi;
    let tm;
    while ((tm = tr.exec(line)) !== null) {
      times.push(parseFloat(tm[1]));
    }
    const timeout = line.includes("*") && !times.length;
    hops.push({
      hop: hopNum,
      ip: ipM ? ipM[1] : timeout ? "*" : "?",
      times,
      timeout,
    });
  }
  const hopLines = hops
    .map((h) =>
      h.timeout
        ? `  ${h.hop}. * * *`
        : `  ${h.hop}. ${h.ip}  ${h.times.map((t) => t + "ms").join(" / ")}`,
    )
    .join("\n");
  return {
    success: true,
    result: { host, hops },
    message: [
      `## Traceroute: ${host}`,
      `**Hops**: ${hops.length}`,
      "",
      hopLines || "  No data",
    ].join("\n"),
  };
}

async function handleCheck(opts) {
  const url = opts.url;
  if (!url) {
    return { success: false, result: null, message: "Usage: --check <url>" };
  }
  logger.info(`[network-diagnostics] HTTP check: ${url}`);
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({
        success: false,
        result: { url },
        message: `Invalid URL: ${url}`,
      });
      return;
    }
    const isS = parsed.protocol === "https:";
    const start = Date.now();
    const req = (isS ? https : http).request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isS ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        timeout: 10000,
        headers: { "User-Agent": "ChainlessChain-NetworkDiagnostics/1.0" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          if (body.length < 1024) {
            body += c;
          }
        });
        res.on("end", () => {
          const ms = Date.now() - start;
          const ct = res.headers["content-type"] || "unknown";
          const sv = res.headers["server"] || "unknown";
          const info = {
            url,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            responseTime: `${ms}ms`,
            contentType: ct,
            server: sv,
            reachable: true,
          };
          resolve({
            success: true,
            result: info,
            message: [
              `## HTTP: ${url}`,
              `**Status**: ${res.statusCode} ${res.statusMessage}`,
              `**Time**: ${ms}ms`,
              `**Type**: ${ct}`,
              `**Server**: ${sv}`,
            ].join("\n"),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      const ms = Date.now() - start;
      resolve({
        success: false,
        result: { url, reachable: false, error: "timeout" },
        message: `HTTP timeout: ${url} (${ms}ms)`,
      });
    });
    req.on("error", (e) => {
      const ms = Date.now() - start;
      resolve({
        success: false,
        result: { url, reachable: false, error: e.code || e.message },
        message: `HTTP error: ${url} — ${e.code || e.message} (${ms}ms)`,
      });
    });
    req.end();
  });
}

function showUsage() {
  return {
    success: true,
    result: { usage: true },
    message: [
      "## Network Diagnostics",
      "",
      "  --ping <host> [--count <n>]            Ping host",
      "  --dns <domain> [--type A|AAAA|MX|...]  DNS lookup",
      "  --port <host> <port>                   TCP port check",
      "  --ports <host> --range <start>-<end>   Port scan (max 100)",
      "  --ip                                   Local IPs",
      "  --trace <host>                         Traceroute",
      "  --check <url>                          HTTP check",
    ].join("\n"),
  };
}

module.exports = {
  async init(skill) {
    logger.info(
      `[network-diagnostics] handler initialized for "${skill?.name || "network-diagnostics"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();
    const { action, opts } = parseInput(input);
    logger.info(`[network-diagnostics] Action: ${action}`, {
      opts,
      projectRoot,
    });
    try {
      switch (action) {
        case "ping":
          return await handlePing(opts);
        case "dns":
          return await handleDns(opts);
        case "port":
          return await handlePort(opts);
        case "ports":
          return await handlePortScan(opts);
        case "ip":
          return await handleIp();
        case "trace":
          return await handleTrace(opts);
        case "check":
          return await handleCheck(opts);
        default:
          return showUsage();
      }
    } catch (error) {
      logger.error(`[network-diagnostics] Error: ${error.message}`);
      return {
        success: false,
        result: { error: error.message },
        message: `Network diagnostics failed: ${error.message}`,
      };
    }
  },
};
