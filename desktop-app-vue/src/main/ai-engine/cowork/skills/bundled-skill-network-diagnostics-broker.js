"use strict";

/**
 * Branded authority for the bundled network-diagnostics Skill.
 *
 * The trusted host chooses exact targets, operations, DNS record types and TCP
 * ports. The handler receives only this narrow surface; DNS, sockets and
 * ProcessExecutionBroker remain on the host side of the boundary.
 */

const nodeDns = require("node:dns");
const nodeNet = require("node:net");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { pathToFileURL } = require("node:url");
const { isForbiddenAddress } = require("../../../mcp/mcp-egress-policy.js");
const { logger } = require("../../../utils/logger.js");

const SKILL_ID = "network-diagnostics";
const OPERATIONS = Object.freeze(["dns", "ping", "port", "trace"]);
const DNS_TYPES = Object.freeze([
  "A",
  "AAAA",
  "MX",
  "TXT",
  "NS",
  "CNAME",
  "SOA",
]);
const MAX_TARGETS = 64;
const MAX_PORTS = 100;
const MAX_PING_COUNT = 10;
const MAX_DNS_RECORDS = 100;
const MAX_DNS_RESPONSE_BYTES = 64 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_AUTHORITY_ID_LENGTH = 256;
const DEFAULT_DNS_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const PROCESS_BROKER_MODULE = nodePath.resolve(
  __dirname,
  "../../../../../../packages/cli/src/lib/process-execution-broker/index.js",
);
const brokerMetadata = new WeakMap();
let processBrokerPromise = null;

function diagnosticsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveInteger(value, fallback, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}

function normalizeTarget(value) {
  const raw = String(value || "").trim();
  if (
    !raw ||
    raw.length > 253 ||
    /[\s/*\\?#@]/.test(raw) ||
    raw.includes("://")
  ) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_INVALID",
      "Network diagnostics targets must be exact hostnames or IP literals",
    );
  }
  if (nodeNet.isIP(raw)) return raw.toLowerCase();

  const normalized = raw.toLowerCase().replace(/\.$/, "");
  const labels = normalized.split(".");
  if (
    !normalized ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_INVALID",
      "Network diagnostics targets must be exact hostnames or IP literals",
    );
  }
  return normalized;
}

function normalizeStringSet(values, allowed, code, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw diagnosticsError(code, `${label} must be a non-empty array`);
  }
  const normalized = [...new Set(values.map((value) => String(value).trim()))];
  if (normalized.some((value) => !allowed.includes(value))) {
    throw diagnosticsError(code, `${label} contains an unsupported value`);
  }
  return Object.freeze(normalized);
}

function normalizePolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_POLICY_INVALID",
      "Network diagnostics authority policy is required",
    );
  }
  if (String(options.skillId || "").trim() !== SKILL_ID) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_SKILL_DENIED",
      "Network diagnostics authority is available only to network-diagnostics",
    );
  }
  const authorityId = String(options.authorityId || "").trim();
  if (!authorityId || authorityId.length > MAX_AUTHORITY_ID_LENGTH) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_AUTHORITY_REQUIRED",
      "A bounded authority decision ID is required",
    );
  }
  if (
    !Array.isArray(options.allowedTargets) ||
    options.allowedTargets.length === 0 ||
    options.allowedTargets.length > MAX_TARGETS
  ) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGETS_REQUIRED",
      `Between 1 and ${MAX_TARGETS} exact targets are required`,
    );
  }
  const allowedTargets = Object.freeze([
    ...new Set(options.allowedTargets.map(normalizeTarget)),
  ]);
  const allowedOperations = normalizeStringSet(
    options.allowedOperations,
    OPERATIONS,
    "CC_BUNDLED_SKILL_DIAGNOSTICS_OPERATIONS_REQUIRED",
    "allowedOperations",
  );
  const allowedDnsTypes = allowedOperations.includes("dns")
    ? normalizeStringSet(
        options.allowedDnsTypes,
        DNS_TYPES,
        "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_TYPES_REQUIRED",
        "allowedDnsTypes",
      )
    : Object.freeze([]);
  const rawPorts = options.allowedPorts || [];
  if (
    !Array.isArray(rawPorts) ||
    rawPorts.length > MAX_PORTS ||
    rawPorts.some(
      (port) => !Number.isSafeInteger(port) || port < 1 || port > 65_535,
    ) ||
    (allowedOperations.includes("port") && rawPorts.length === 0)
  ) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_PORTS_REQUIRED",
      `Port diagnostics require 1-${MAX_PORTS} explicit TCP ports`,
    );
  }

  return Object.freeze({
    skillId: SKILL_ID,
    authorityId,
    allowedTargets,
    allowedOperations,
    allowedDnsTypes,
    allowedPorts: Object.freeze([...new Set(rawPorts)].sort((a, b) => a - b)),
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    maxPingCount: positiveInteger(options.maxPingCount, 4, MAX_PING_COUNT),
    dnsTimeoutMs: positiveInteger(
      options.dnsTimeoutMs,
      DEFAULT_DNS_TIMEOUT_MS,
      DEFAULT_DNS_TIMEOUT_MS,
    ),
    connectTimeoutMs: positiveInteger(
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    commandTimeoutMs: positiveInteger(
      options.commandTimeoutMs,
      DEFAULT_COMMAND_TIMEOUT_MS,
      DEFAULT_COMMAND_TIMEOUT_MS,
    ),
  });
}

function defaultAuditSink(entry) {
  logger.info("[bundled-skill-network-diagnostics-broker]", entry);
}

async function loadProcessBroker() {
  if (!processBrokerPromise) {
    processBrokerPromise = import(
      pathToFileURL(PROCESS_BROKER_MODULE).href
    ).then((module) => {
      const broker = module.executionBroker || module.default;
      if (!broker || typeof broker.execFile !== "function") {
        throw diagnosticsError(
          "CC_BUNDLED_SKILL_DIAGNOSTICS_PROCESS_BROKER_UNAVAILABLE",
          "ProcessExecutionBroker exports are unavailable",
        );
      }
      return broker;
    });
  }
  return processBrokerPromise;
}

function minimalRuntimeEnv(env = process.env) {
  const result = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (env[key] != null) result[key] = env[key];
  }
  return result;
}

function createBundledSkillNetworkDiagnosticsBroker(options, deps = {}) {
  const policy = normalizePolicy(options);
  const auditSink = deps.auditSink || defaultAuditSink;
  const lookup = deps.lookup || nodeDns.lookup;
  const createConnection = deps.createConnection || nodeNet.createConnection;
  const createResolver =
    deps.createResolver || (() => new nodeDns.promises.Resolver());
  const loadBroker = deps.loadProcessBroker || loadProcessBroker;
  const platform = deps.platform || nodeOs.platform();
  const runtimeEnv = deps.env || process.env;

  function assertRequest(operation, target) {
    const normalizedTarget = normalizeTarget(target);
    if (!policy.allowedOperations.includes(operation)) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_OPERATION_DENIED",
        `Network diagnostics operation is not approved: ${operation}`,
      );
    }
    if (!policy.allowedTargets.includes(normalizedTarget)) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_DENIED",
        `Network diagnostics target is not approved: ${normalizedTarget}`,
      );
    }
    return normalizedTarget;
  }

  function audit(operation, target, details = {}) {
    auditSink(
      Object.freeze({
        event: "bundled-skill-network-diagnostics",
        skillId: policy.skillId,
        authorityId: policy.authorityId,
        operation,
        target,
        outcome: "allowed",
        ...details,
      }),
    );
  }

  function resolveAddresses(target, timeoutMs) {
    if (nodeNet.isIP(target)) {
      if (!policy.allowPrivateNetwork && isForbiddenAddress(target)) {
        return Promise.reject(
          diagnosticsError(
            "CC_BUNDLED_SKILL_DIAGNOSTICS_ADDRESS_DENIED",
            `Network diagnostics address is private or reserved: ${target}`,
          ),
        );
      }
      return Promise.resolve([
        { address: target, family: nodeNet.isIP(target) },
      ]);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          diagnosticsError(
            "CC_BUNDLED_SKILL_DIAGNOSTICS_LOOKUP_TIMEOUT",
            `DNS address lookup timed out for ${target}`,
          ),
        );
      }, timeoutMs);
      lookup(target, { all: true, verbatim: true }, (error, records) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) return reject(error);
        const addresses = Array.isArray(records) ? records : [records];
        if (
          addresses.length === 0 ||
          addresses.some(
            (record) =>
              !record ||
              !nodeNet.isIP(record.address) ||
              (!policy.allowPrivateNetwork &&
                isForbiddenAddress(record.address)),
          )
        ) {
          return reject(
            diagnosticsError(
              "CC_BUNDLED_SKILL_DIAGNOSTICS_ADDRESS_DENIED",
              `DNS returned a private, reserved, or invalid address for ${target}`,
            ),
          );
        }
        return resolve(addresses);
      });
    });
  }

  async function resolveDns({ target, type = "A" }) {
    const normalizedTarget = assertRequest("dns", target);
    const normalizedType = String(type || "A").toUpperCase();
    if (!policy.allowedDnsTypes.includes(normalizedType)) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_TYPE_DENIED",
        `DNS record type is not approved: ${normalizedType}`,
      );
    }
    audit("dns", normalizedTarget, { dnsType: normalizedType });
    const resolver = createResolver();
    const methodByType = {
      A: "resolve4",
      AAAA: "resolve6",
      MX: "resolveMx",
      TXT: "resolveTxt",
      NS: "resolveNs",
      CNAME: "resolveCname",
      SOA: "resolveSoa",
    };
    const method = methodByType[normalizedType];
    if (!resolver || typeof resolver[method] !== "function") {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_RESOLVER_UNAVAILABLE",
        `DNS resolver does not support ${normalizedType}`,
      );
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        resolver.cancel?.();
        reject(
          diagnosticsError(
            "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_TIMEOUT",
            `DNS query timed out for ${normalizedTarget}`,
          ),
        );
      }, policy.dnsTimeoutMs);
    });
    let raw;
    try {
      raw = await Promise.race([resolver[method](normalizedTarget), timeout]);
    } finally {
      clearTimeout(timer);
    }
    let records;
    if (normalizedType === "MX") {
      records = raw
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((record) => `${record.priority} ${record.exchange}`);
    } else if (normalizedType === "TXT") {
      records = raw.map((record) => record.join(""));
    } else if (normalizedType === "SOA") {
      records = [
        `nsname=${raw.nsname} hostmaster=${raw.hostmaster} serial=${raw.serial}`,
      ];
    } else {
      records = raw.map(String);
    }
    if (
      records.length > MAX_DNS_RECORDS ||
      Buffer.byteLength(JSON.stringify(records), "utf8") >
        MAX_DNS_RESPONSE_BYTES
    ) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_RESPONSE_TOO_LARGE",
        "DNS response exceeded the diagnostics result limit",
      );
    }
    return Object.freeze([...records]);
  }

  async function checkPort({ target, port, timeoutMs }) {
    const normalizedTarget = assertRequest("port", target);
    if (!policy.allowedPorts.includes(port)) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_PORT_DENIED",
        `TCP port is not approved: ${port}`,
      );
    }
    const boundedTimeout = positiveInteger(
      timeoutMs,
      policy.connectTimeoutMs,
      policy.connectTimeoutMs,
    );
    audit("port", normalizedTarget, { port });
    const addresses = await resolveAddresses(
      normalizedTarget,
      policy.dnsTimeoutMs,
    );
    return await new Promise((resolve) => {
      let socket;
      let settled = false;
      const finish = (open) => {
        if (settled) return;
        settled = true;
        socket?.destroy?.();
        resolve(Object.freeze({ port, open }));
      };
      try {
        socket = createConnection({
          host: addresses[0].address,
          port,
          family: addresses[0].family,
        });
        socket.setTimeout(boundedTimeout);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  async function runCommand(
    operation,
    target,
    argsForPlatform,
    timeoutMs,
    auditDetails = {},
  ) {
    const normalizedTarget = assertRequest(operation, target);
    audit(operation, normalizedTarget, auditDetails);
    const addresses = await resolveAddresses(
      normalizedTarget,
      policy.dnsTimeoutMs,
    );
    const broker = await loadBroker();
    if (!broker || typeof broker.execFile !== "function") {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_PROCESS_BROKER_UNAVAILABLE",
        "ProcessExecutionBroker is unavailable",
      );
    }
    const command =
      operation === "ping"
        ? platform === "win32"
          ? "ping.exe"
          : "ping"
        : platform === "win32"
          ? "tracert.exe"
          : "traceroute";
    const args = argsForPlatform(platform, addresses[0].address);
    return await new Promise((resolve, reject) => {
      broker
        .execFile(
          command,
          args,
          {
            origin: `skill:${SKILL_ID}:${operation}`,
            scope: "cowork-skill-network-diagnostics",
            policy: "allow",
            shell: false,
            windowsHide: true,
            timeout: Math.min(timeoutMs, policy.commandTimeoutMs),
            maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
            encoding: "utf8",
            env: minimalRuntimeEnv(runtimeEnv),
            stdio: ["pipe", "pipe", "pipe"],
          },
          (error, stdout) => {
            const output = String(stdout || "").trim();
            if (output) return resolve(output);
            if (error) return resolve(null);
            return resolve("");
          },
        )
        ?.once?.("error", reject);
    });
  }

  async function runPing({ target, count = 4 }) {
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > policy.maxPingCount
    ) {
      throw diagnosticsError(
        "CC_BUNDLED_SKILL_DIAGNOSTICS_PING_COUNT_DENIED",
        `Ping count must be between 1 and ${policy.maxPingCount}`,
      );
    }
    return runCommand(
      "ping",
      target,
      (currentPlatform, address) =>
        currentPlatform === "win32"
          ? ["-n", String(count), address]
          : ["-c", String(count), address],
      30_000,
      { count },
    );
  }

  async function runTrace({ target }) {
    return runCommand(
      "trace",
      target,
      (currentPlatform, address) =>
        currentPlatform === "win32"
          ? ["-d", "-w", "3000", address]
          : ["-n", "-w", "3", address],
      60_000,
    );
  }

  const broker = Object.freeze({ checkPort, resolveDns, runPing, runTrace });
  brokerMetadata.set(broker, policy);
  return broker;
}

function requireBundledSkillNetworkDiagnosticsBroker(context) {
  const broker = context?.networkDiagnosticsBroker;
  const metadata =
    broker && typeof broker === "object" ? brokerMetadata.get(broker) : null;
  if (
    !metadata ||
    metadata.skillId !== SKILL_ID ||
    typeof broker.checkPort !== "function" ||
    typeof broker.resolveDns !== "function" ||
    typeof broker.runPing !== "function" ||
    typeof broker.runTrace !== "function"
  ) {
    throw diagnosticsError(
      "CC_BUNDLED_SKILL_DIAGNOSTICS_BROKER_UNAVAILABLE",
      "Trusted network diagnostics authority is unavailable; raw diagnostics are disabled",
    );
  }
  return broker;
}

module.exports = {
  createBundledSkillNetworkDiagnosticsBroker,
  requireBundledSkillNetworkDiagnosticsBroker,
};
