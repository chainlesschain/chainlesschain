"use strict";

/**
 * Production network/declassification authority for reviewed bundled Skills.
 */

const {
  BUNDLED_SKILL_EGRESS_POLICIES,
  createBundledSkillFixedNetworkBroker,
  createBundledSkillRuntimeNetworkBroker,
} = require("./bundled-skill-egress-broker");
const {
  BUNDLED_SKILL_LOCAL_SERVICE_POLICIES,
  createBundledSkillLocalServiceBroker,
} = require("./bundled-skill-local-service-broker");
const {
  createBundledSkillNetworkDiagnosticsBroker,
} = require("./bundled-skill-network-diagnostics-broker");

const MAX_TASK_SCAN_STRINGS = 256;
const MAX_TASK_SCAN_BYTES = 256 * 1024;
const MAX_RUNTIME_DOMAINS = 64;
const DNS_TYPES = new Set(["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"]);
const LOCAL_SERVICE_URLS = Object.freeze({
  "free-model-manager": "http://127.0.0.1:11434/",
  "image-generator": "http://127.0.0.1:7860/",
});

function authorityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function taskInput(task) {
  return String(
    task?.params?.input || task?.input || task?.action || "",
  ).trim();
}

function collectTaskStrings(value, output = [], seen = new Set()) {
  if (
    output.length >= MAX_TASK_SCAN_STRINGS ||
    value === null ||
    value === undefined
  ) {
    return output;
  }
  if (typeof value === "string") {
    const currentBytes = output.reduce(
      (total, item) => total + Buffer.byteLength(item, "utf8"),
      0,
    );
    if (currentBytes < MAX_TASK_SCAN_BYTES) {
      output.push(
        value.slice(0, Math.max(0, MAX_TASK_SCAN_BYTES - currentBytes)),
      );
    }
    return output;
  }
  if (typeof value !== "object" || seen.has(value)) {
    return output;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_TASK_SCAN_STRINGS)) {
      collectTaskStrings(item, output, seen);
    }
    return output;
  }
  for (const key of Object.keys(value).sort().slice(0, MAX_TASK_SCAN_STRINGS)) {
    collectTaskStrings(value[key], output, seen);
  }
  return output;
}

function deriveApprovedDomains(task) {
  const domains = new Set();
  for (const text of collectTaskStrings(task)) {
    for (const match of text.matchAll(/https:\/\/[^\s"'<>`]+/gi)) {
      try {
        const url = new URL(match[0]);
        if (!url.username && !url.password) {
          domains.add(url.hostname.toLowerCase().replace(/\.$/, ""));
        }
      } catch {
        // Invalid URLs remain unavailable to the runtime broker.
      }
      if (domains.size >= MAX_RUNTIME_DOMAINS) {
        break;
      }
    }
    if (domains.size >= MAX_RUNTIME_DOMAINS) {
      break;
    }
  }
  return [...domains].sort();
}

function parseNetworkDiagnosticsPolicy(task) {
  const parts = taskInput(task).split(/\s+/).filter(Boolean);
  let action = null;
  const options = {};
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (["--ping", "ping"].includes(part)) {
      action = "ping";
      options.target = parts[++index] || "";
    } else if (["--dns", "dns"].includes(part)) {
      action = "dns";
      options.target = parts[++index] || "";
    } else if (["--port", "port"].includes(part)) {
      action = "port";
      options.target = parts[++index] || "";
      options.port = Number(parts[++index]);
    } else if (["--ports", "ports"].includes(part)) {
      action = "ports";
      options.target = parts[++index] || "";
    } else if (["--trace", "trace"].includes(part)) {
      action = "trace";
      options.target = parts[++index] || "";
    } else if (part === "--type") {
      options.dnsType = String(parts[++index] || "A").toUpperCase();
    } else if (part === "--range") {
      options.range = parts[++index] || "";
    } else if (part === "--count") {
      options.count = Number(parts[++index]);
    }
  }
  if (!action || !options.target) {
    return null;
  }

  const policy = {
    allowedTargets: [options.target],
    allowedOperations: [action === "ports" ? "port" : action],
    allowedDnsTypes: [],
    allowedPorts: [],
  };
  if (action === "dns") {
    policy.allowedDnsTypes = [
      DNS_TYPES.has(options.dnsType) ? options.dnsType : "A",
    ];
  }
  if (action === "port" && Number.isSafeInteger(options.port)) {
    policy.allowedPorts = [options.port];
  }
  if (action === "ports") {
    const [start, end] = options.range.split("-").map(Number);
    if (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 1 &&
      end <= 65_535 &&
      start <= end &&
      end - start < 100
    ) {
      policy.allowedPorts = Array.from(
        { length: end - start + 1 },
        (_, index) => start + index,
      );
    }
  }
  if (Number.isSafeInteger(options.count)) {
    policy.maxPingCount = options.count;
  }
  return policy;
}

function createBundledSkillNetworkAuthorityFactory(options = {}) {
  const domainResolver = options.domainResolver || deriveApprovedDomains;
  const localServiceResolver =
    options.localServiceResolver ||
    (({ skillId }) => LOCAL_SERVICE_URLS[skillId] || null);
  const diagnosticsPolicyResolver =
    options.diagnosticsPolicyResolver || parseNetworkDiagnosticsPolicy;

  return async function createNetworkAuthority(request = {}) {
    const skillId = String(request.skillId || "").trim();
    if (
      !BUNDLED_SKILL_EGRESS_POLICIES[skillId] &&
      ![
        "api-gateway",
        "http-client",
        "network-diagnostics",
        "summarizer",
      ].includes(skillId)
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_NETWORK_POLICY_REQUIRED",
        `No reviewed network policy exists for ${skillId || "unknown"}`,
      );
    }
    if (
      request.executionDecision?.approved !== true ||
      request.executionDecision?.policyAuthorized !== true
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_NETWORK_APPROVAL_REQUIRED",
        `An approved host execution decision is required for ${skillId}`,
      );
    }

    let networkBroker = null;
    if (BUNDLED_SKILL_EGRESS_POLICIES[skillId]) {
      networkBroker = createBundledSkillFixedNetworkBroker(
        skillId,
        options.egressDependencies,
      );
    } else {
      const allowedDomains = domainResolver(request.task, {
        skillId,
        executionDecision: request.executionDecision,
      });
      if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
        networkBroker = createBundledSkillRuntimeNetworkBroker(
          {
            skillId,
            allowedDomains,
            declassificationId: request.executionDecision.authorityId,
          },
          options.egressDependencies,
        );
      }
    }

    let localServiceBroker = null;
    const localPolicy = BUNDLED_SKILL_LOCAL_SERVICE_POLICIES[skillId];
    if (localPolicy) {
      const baseUrl = localServiceResolver({
        skillId,
        serviceId: localPolicy.serviceId,
        task: request.task,
        executionDecision: request.executionDecision,
      });
      if (baseUrl) {
        localServiceBroker = createBundledSkillLocalServiceBroker(
          {
            skillId,
            serviceId: localPolicy.serviceId,
            authorityId: request.executionDecision.authorityId,
            baseUrl,
          },
          options.localServiceDependencies,
        );
      }
    }

    let networkDiagnosticsBroker = null;
    if (skillId === "network-diagnostics") {
      const diagnosticsPolicy = diagnosticsPolicyResolver(request.task, {
        executionDecision: request.executionDecision,
      });
      if (diagnosticsPolicy) {
        networkDiagnosticsBroker = createBundledSkillNetworkDiagnosticsBroker(
          {
            skillId,
            authorityId: request.executionDecision.authorityId,
            allowPrivateNetwork: options.allowPrivateDiagnostics === true,
            ...diagnosticsPolicy,
          },
          options.diagnosticsDependencies,
        );
      }
    }

    return Object.freeze({
      networkBroker,
      localServiceBroker,
      networkDiagnosticsBroker,
    });
  };
}

module.exports = {
  createBundledSkillNetworkAuthorityFactory,
  deriveApprovedDomains,
  parseNetworkDiagnosticsPolicy,
};
