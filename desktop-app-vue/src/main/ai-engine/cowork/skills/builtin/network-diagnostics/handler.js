/**
 * Network Diagnostics Skill Handler
 *
 * Ping, DNS lookup, port check, port scan, local IP, traceroute, HTTPS check.
 * Privileged diagnostics are delegated to host-created, branded authorities.
 */

const os = require("os");
const { logger } = require("../../../../../utils/logger.js");
const {
  requireBundledSkillRuntimeNetworkBroker,
} = require("../../bundled-skill-egress-broker.js");
const {
  requireBundledSkillNetworkDiagnosticsBroker,
} = require("../../bundled-skill-network-diagnostics-broker.js");

const DNS_TYPES = Object.freeze([
  "A",
  "AAAA",
  "MX",
  "TXT",
  "NS",
  "CNAME",
  "SOA",
]);

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  const opts = {};
  let action = "help";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--ping" || part === "ping") {
      action = "ping";
      opts.host = parts[++i] || "";
    } else if (part === "--dns" || part === "dns") {
      action = "dns";
      opts.domain = parts[++i] || "";
    } else if (part === "--port" || part === "port") {
      action = "port";
      opts.host = parts[++i] || "";
      opts.port = parseInt(parts[++i], 10) || 0;
    } else if (part === "--ports" || part === "ports") {
      action = "ports";
      opts.host = parts[++i] || "";
    } else if (part === "--ip" || part === "ip") {
      action = "ip";
    } else if (part === "--trace" || part === "trace") {
      action = "trace";
      opts.host = parts[++i] || "";
    } else if (part === "--check" || part === "check") {
      action = "check";
      opts.url = parts[++i] || "";
    } else if (part === "--count") {
      const count = parseInt(parts[++i], 10);
      if (count > 0 && count <= 10) opts.count = count;
    } else if (part === "--type") {
      opts.type = (parts[++i] || "A").toUpperCase();
    } else if (part === "--range") {
      opts.range = parts[++i] || "";
    }
  }
  return { action, opts };
}

async function handlePing(opts, broker) {
  const host = opts.host;
  if (!host) {
    return {
      success: false,
      result: null,
      message: "Usage: --ping <host> [--count <n>]",
    };
  }
  const count = opts.count || 4;
  const isWindows = os.platform() === "win32";
  logger.info(`[network-diagnostics] Ping: ${host} count=${count}`);
  const output = await broker.runPing({ target: host, count });
  if (!output) {
    return {
      success: false,
      result: { host, reachable: false },
      message: `Ping ${host}: unreachable`,
    };
  }

  const times = [];
  const timePattern = isWindows
    ? /[=<](\d+(?:\.\d+)?)ms/gi
    : /time[=<](\d+(?:\.\d+)?)\s*ms/gi;
  let match;
  while ((match = timePattern.exec(output)) !== null) {
    times.push(parseFloat(match[1]));
  }
  const lossMatch = output.match(/(\d+)%\s*(packet\s*)?loss/i);
  const loss = lossMatch ? parseInt(lossMatch[1], 10) : null;
  const receivedMatch = output.match(
    isWindows ? /Received\s*=\s*(\d+)/i : /(\d+)\s+(packets?\s+)?received/i,
  );
  const received = receivedMatch
    ? parseInt(receivedMatch[1], 10)
    : times.length;
  const average = times.length
    ? (times.reduce((left, right) => left + right, 0) / times.length).toFixed(2)
    : null;
  const minimum = times.length ? Math.min(...times).toFixed(2) : null;
  const maximum = times.length ? Math.max(...times).toFixed(2) : null;
  const info = {
    host,
    transmitted: count,
    received,
    packetLoss: loss !== null ? `${loss}%` : "unknown",
    times,
    min: minimum && `${minimum}ms`,
    avg: average && `${average}ms`,
    max: maximum && `${maximum}ms`,
    reachable: received > 0,
  };
  return {
    success: true,
    result: info,
    message: [
      `## Ping ${host}`,
      `**Packets**: ${count} sent, ${received} received${loss !== null ? `, ${loss}% loss` : ""}`,
      times.length
        ? `**RTT**: min=${minimum}ms, avg=${average}ms, max=${maximum}ms`
        : "**RTT**: No responses",
    ].join("\n"),
  };
}

async function handleDns(opts, broker) {
  const domain = opts.domain;
  if (!domain) {
    return {
      success: false,
      result: null,
      message: "Usage: --dns <domain> [--type A|AAAA|MX|TXT|NS|CNAME|SOA]",
    };
  }
  const type = opts.type || "A";
  if (!DNS_TYPES.includes(type)) {
    return {
      success: false,
      result: null,
      message: `Unsupported type: ${type}. Use ${DNS_TYPES.join("|")}`,
    };
  }
  logger.info(`[network-diagnostics] DNS: ${domain} type=${type}`);
  try {
    const records = await broker.resolveDns({ target: domain, type });
    return {
      success: true,
      result: { domain, type, records },
      message: [
        `## DNS: ${domain} (${type})`,
        `**Records** (${records.length}):`,
        ...records.map((record) => `  ${record}`),
      ].join("\n"),
    };
  } catch (error) {
    return {
      success: false,
      result: { domain, type, error: error.code || error.message },
      message: `DNS failed: ${domain} (${type}): ${error.code || error.message}`,
    };
  }
}

async function handlePort(opts, broker) {
  const { host, port } = opts;
  if (!host || !port || port < 1 || port > 65_535) {
    return {
      success: false,
      result: null,
      message: "Usage: --port <host> <port>",
    };
  }
  logger.info(`[network-diagnostics] Port check: ${host}:${port}`);
  const result = await broker.checkPort({
    target: host,
    port,
    timeoutMs: 5000,
  });
  const status = result.open ? "OPEN" : "CLOSED";
  return {
    success: true,
    result: { host, port, open: result.open, status },
    message: `## Port ${host}:${port}\n**Status**: ${status}`,
  };
}

async function handlePortScan(opts, broker) {
  const { host, range } = opts;
  if (!host || !range) {
    return {
      success: false,
      result: null,
      message: "Usage: --ports <host> --range <start>-<end> (max 100)",
    };
  }
  const [start, end] = range.split("-").map(Number);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end > 65_535 ||
    start > end
  ) {
    return {
      success: false,
      result: null,
      message: "Invalid range. Format: <start>-<end>",
    };
  }
  if (end - start + 1 > 100) {
    return {
      success: false,
      result: null,
      message: `Range too large (${end - start + 1}). Max 100 ports.`,
    };
  }
  logger.info(`[network-diagnostics] Port scan: ${host} ${start}-${end}`);
  const ports = Array.from(
    { length: end - start + 1 },
    (_, index) => start + index,
  );
  const results = [];
  for (let offset = 0; offset < ports.length; offset += 10) {
    results.push(
      ...(await Promise.all(
        ports
          .slice(offset, offset + 10)
          .map((port) =>
            broker.checkPort({ target: host, port, timeoutMs: 3000 }),
          ),
      )),
    );
  }
  const open = results.filter((result) => result.open);
  const info = {
    host,
    rangeStart: start,
    rangeEnd: end,
    totalScanned: ports.length,
    openCount: open.length,
    openPorts: open.map((result) => result.port),
  };
  return {
    success: true,
    result: info,
    message: [
      `## Port Scan: ${host} (${start}-${end})`,
      `**Scanned**: ${ports.length}  **Open**: ${open.length}`,
      "",
      open.length
        ? open.map((result) => `  ${result.port} OPEN`).join("\n")
        : "  None",
    ].join("\n"),
  };
}

async function handleIp() {
  const interfaces = [];
  const externalIPv4 = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    const entries = (addresses || []).map((address) => ({
      address: address.address,
      family: address.family,
      netmask: address.netmask,
      mac: address.mac,
      internal: address.internal,
    }));
    interfaces.push({ name, addresses: entries });
    for (const address of entries) {
      if (!address.internal && address.family === "IPv4") {
        externalIPv4.push({ iface: name, address: address.address });
      }
    }
  }
  const hostname = os.hostname();
  const info = { hostname, interfaces, externalIPv4 };
  const interfaceLines = interfaces
    .map(
      (entry) =>
        `  **${entry.name}**: ${entry.addresses.map((address) => `${address.family}=${address.address}`).join(", ")}`,
    )
    .join("\n");
  const primary = externalIPv4.length
    ? externalIPv4
        .map((entry) => `  ${entry.iface}: ${entry.address}`)
        .join("\n")
    : "  No external IPv4";
  return {
    success: true,
    result: info,
    message: [
      "## Local IPs",
      `**Hostname**: ${hostname}`,
      "",
      "### Primary IPv4",
      primary,
      "",
      "### All Interfaces",
      interfaceLines,
    ].join("\n"),
  };
}

async function handleTrace(opts, broker) {
  const host = opts.host;
  if (!host) {
    return { success: false, result: null, message: "Usage: --trace <host>" };
  }
  logger.info(`[network-diagnostics] Traceroute: ${host}`);
  const output = await broker.runTrace({ target: host });
  if (!output) {
    return {
      success: false,
      result: { host, hops: [] },
      message: `Traceroute to ${host} failed`,
    };
  }
  const hops = [];
  for (const line of output.split("\n")) {
    const hopMatch = line.match(/^\s*(\d+)\s+/);
    if (!hopMatch) continue;
    const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const times = [];
    const timePattern = /(\d+(?:\.\d+)?)\s*ms/gi;
    let timeMatch;
    while ((timeMatch = timePattern.exec(line)) !== null) {
      times.push(parseFloat(timeMatch[1]));
    }
    const timeout = line.includes("*") && !times.length;
    hops.push({
      hop: parseInt(hopMatch[1], 10),
      ip: ipMatch ? ipMatch[1] : timeout ? "*" : "?",
      times,
      timeout,
    });
  }
  return {
    success: true,
    result: { host, hops },
    message: [
      `## Traceroute: ${host}`,
      `**Hops**: ${hops.length}`,
      "",
      hops
        .map((hop) =>
          hop.timeout
            ? `  ${hop.hop}. * * *`
            : `  ${hop.hop}. ${hop.ip}  ${hop.times.map((time) => `${time}ms`).join(" / ")}`,
        )
        .join("\n") || "  No data",
    ].join("\n"),
  };
}

async function handleCheck(opts, broker) {
  const url = opts.url;
  if (!url) {
    return { success: false, result: null, message: "Usage: --check <url>" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {
      success: false,
      result: { url },
      message: `Invalid URL: ${url}`,
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      success: false,
      result: { url },
      message: `HTTPS is required: ${url}`,
    };
  }
  logger.info(`[network-diagnostics] HTTPS check: ${url}`);
  try {
    const response = await broker.request({
      url: parsed.toString(),
      method: "GET",
      timeout: 10_000,
      maxResponseBytes: 1024,
      headers: { "User-Agent": "ChainlessChain-NetworkDiagnostics/1.0" },
    });
    const contentType = response.headers["content-type"] || "unknown";
    const server = response.headers.server || "unknown";
    const responseTime = `${response.duration}ms`;
    return {
      success: true,
      result: {
        url,
        statusCode: response.status,
        statusMessage: response.statusText,
        responseTime,
        contentType,
        server,
        reachable: true,
      },
      message: [
        `## HTTPS: ${url}`,
        `**Status**: ${response.status} ${response.statusText}`,
        `**Time**: ${responseTime}`,
        `**Type**: ${contentType}`,
        `**Server**: ${server}`,
      ].join("\n"),
    };
  } catch (error) {
    return {
      success: false,
      result: {
        url,
        reachable: false,
        error: error.code || error.message,
      },
      message: `HTTPS error: ${url} — ${error.code || error.message}`,
    };
  }
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
      "  --check <url>                          HTTPS check",
    ].join("\n"),
  };
}

module.exports = {
  async init(skill) {
    logger.info(
      `[network-diagnostics] handler initialized for "${skill?.name || "network-diagnostics"}"`,
    );
  },

  async execute(task, context = {}, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const { action, opts } = parseInput(input);
    logger.info(`[network-diagnostics] Action: ${action}`, { opts });
    try {
      switch (action) {
        case "ping":
          return await handlePing(
            opts,
            requireBundledSkillNetworkDiagnosticsBroker(context),
          );
        case "dns":
          return await handleDns(
            opts,
            requireBundledSkillNetworkDiagnosticsBroker(context),
          );
        case "port":
          return await handlePort(
            opts,
            requireBundledSkillNetworkDiagnosticsBroker(context),
          );
        case "ports":
          return await handlePortScan(
            opts,
            requireBundledSkillNetworkDiagnosticsBroker(context),
          );
        case "ip":
          return await handleIp();
        case "trace":
          return await handleTrace(
            opts,
            requireBundledSkillNetworkDiagnosticsBroker(context),
          );
        case "check":
          return await handleCheck(
            opts,
            requireBundledSkillRuntimeNetworkBroker(
              context,
              "network-diagnostics",
            ),
          );
        default:
          return showUsage();
      }
    } catch (error) {
      logger.error(`[network-diagnostics] Error: ${error.message}`);
      return {
        success: false,
        result: { error: error.code || error.message },
        message: `Network diagnostics failed: ${error.code || error.message}`,
      };
    }
  },
};
