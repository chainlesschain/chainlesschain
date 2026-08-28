"use strict";

/**
 * Fixed-policy HTTPS broker for package-owned bundled Skills.
 *
 * Bundled handlers receive a Node-compatible `request`/`get` surface, while
 * this module owns domain allowlists, DNS/IP validation, TLS requirements,
 * request/response limits, timeouts, and audit records. No handler can supply
 * a custom lookup/agent/socket or weaken certificate validation.
 */

const nodeHttps = require("node:https");
const {
  createValidatedLookup,
  domainAllowed,
} = require("../../../mcp/mcp-egress-policy.js");
const { logger } = require("../../../utils/logger.js");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;

const BUNDLED_SKILL_EGRESS_POLICIES = Object.freeze({
  "github-manager": Object.freeze({
    allowedDomains: Object.freeze(["api.github.com"]),
  }),
  "google-workspace": Object.freeze({
    allowedDomains: Object.freeze([
      "gmail.googleapis.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
    ]),
  }),
  "news-monitor": Object.freeze({
    allowedDomains: Object.freeze([
      "api.github.com",
      "hacker-news.firebaseio.com",
      "www.reddit.com",
    ]),
  }),
  notion: Object.freeze({
    allowedDomains: Object.freeze(["api.notion.com"]),
  }),
  "tavily-search": Object.freeze({
    allowedDomains: Object.freeze(["api.tavily.com"]),
  }),
  weather: Object.freeze({
    allowedDomains: Object.freeze(["wttr.in"]),
  }),
  "youtube-summarizer": Object.freeze({
    allowedDomains: Object.freeze(["youtube.com", "*.youtube.com"]),
  }),
});

function brokerError(code, message) {
  const error = new Error(message);
  error.name = "BundledSkillEgressError";
  error.code = code;
  return error;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}

function normalizePolicy(skillId) {
  const policy = BUNDLED_SKILL_EGRESS_POLICIES[skillId];
  if (!policy) {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_POLICY_MISSING",
      `Bundled Skill ${String(skillId || "unknown")} has no reviewed egress policy`,
    );
  }
  return policy;
}

function parseRequestArguments(input, options, callback) {
  let requestOptions = options;
  let responseCallback = callback;
  if (typeof requestOptions === "function") {
    responseCallback = requestOptions;
    requestOptions = undefined;
  }

  let url;
  if (typeof input === "string" || input instanceof URL) {
    try {
      url = new URL(String(input));
    } catch {
      throw brokerError(
        "CC_BUNDLED_SKILL_EGRESS_URL_INVALID",
        "Bundled Skill egress requires a valid URL",
      );
    }
    requestOptions = { ...(requestOptions || {}) };
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    requestOptions = { ...input, ...(requestOptions || {}) };
    const protocol = requestOptions.protocol || "https:";
    const hostname = requestOptions.hostname || requestOptions.host;
    const port = requestOptions.port ? `:${requestOptions.port}` : "";
    const requestPath = requestOptions.path || "/";
    try {
      url = new URL(`${protocol}//${hostname || ""}${port}${requestPath}`);
    } catch {
      throw brokerError(
        "CC_BUNDLED_SKILL_EGRESS_URL_INVALID",
        "Bundled Skill egress requires valid request options",
      );
    }
  } else {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_URL_INVALID",
      "Bundled Skill egress requires a URL or request options",
    );
  }

  return { url, options: requestOptions || {}, callback: responseCallback };
}

function assertRequestAllowed(skillId, policy, url, options) {
  if (url.protocol !== "https:") {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_HTTPS_REQUIRED",
      `Bundled Skill ${skillId} egress requires HTTPS`,
    );
  }
  if (!domainAllowed(url.hostname, policy.allowedDomains)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
      `Bundled Skill ${skillId} cannot access ${url.hostname}`,
    );
  }
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_PORT_DENIED",
      `Bundled Skill ${skillId} cannot access HTTPS port ${port}`,
    );
  }
  if (
    options.socketPath != null ||
    options.createConnection != null ||
    options.agent != null ||
    options.lookup != null ||
    options.rejectUnauthorized === false ||
    options.checkServerIdentity != null ||
    options.secureContext != null ||
    options.ca != null ||
    options.cert != null ||
    options.key != null ||
    options.pfx != null ||
    options.ciphers != null ||
    options.secureProtocol != null ||
    Object.keys(options.headers || {}).some(
      (header) => header.toLowerCase() === "host",
    )
  ) {
    throw brokerError(
      "CC_BUNDLED_SKILL_EGRESS_OVERRIDE_DENIED",
      `Bundled Skill ${skillId} cannot override the egress transport`,
    );
  }
}

function chunkBytes(chunk, encoding) {
  if (chunk == null) return 0;
  if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
    return chunk.byteLength;
  }
  return Buffer.byteLength(String(chunk), encoding || "utf8");
}

function enforceRequestLimit(req, maxRequestBytes, onViolation) {
  let sentBytes = 0;
  let violated = false;
  const rejectOversize = () => {
    const error = brokerError(
      "CC_BUNDLED_SKILL_EGRESS_REQUEST_TOO_LARGE",
      "Bundled Skill request exceeds the configured byte limit",
    );
    if (!violated) {
      violated = true;
      onViolation(error);
    }
    req.destroy?.(error);
  };
  const originalWrite = req.write;
  const originalEnd = req.end;
  if (typeof originalWrite === "function") {
    req.write = function brokeredWrite(chunk, encoding, callback) {
      sentBytes += chunkBytes(chunk, encoding);
      if (sentBytes > maxRequestBytes) {
        rejectOversize();
        return false;
      }
      return originalWrite.call(this, chunk, encoding, callback);
    };
  }
  if (typeof originalEnd === "function") {
    req.end = function brokeredEnd(chunk, encoding, callback) {
      sentBytes += chunkBytes(chunk, encoding);
      if (sentBytes > maxRequestBytes) {
        rejectOversize();
        return this;
      }
      return originalEnd.call(this, chunk, encoding, callback);
    };
  }
}

function enforceResponseLimit(res, req, maxResponseBytes, onViolation) {
  let receivedBytes = 0;
  let violated = false;
  res.on("data", (chunk) => {
    receivedBytes += chunkBytes(chunk);
    if (receivedBytes > maxResponseBytes && !violated) {
      violated = true;
      const error = brokerError(
        "CC_BUNDLED_SKILL_EGRESS_RESPONSE_TOO_LARGE",
        "Bundled Skill response exceeds the configured byte limit",
      );
      onViolation(error);
      res.destroy?.(error);
      req.destroy?.(error);
    }
  });
}

function defaultAuditSink(event) {
  logger.info(`[BundledSkillEgress] ${JSON.stringify(event)}`);
}

function emitAudit(auditSink, base, outcome, reason = null) {
  auditSink(
    Object.freeze({
      event: "bundled-skill-egress",
      timestamp: new Date().toISOString(),
      ...base,
      outcome,
      ...(reason ? { reason } : {}),
    }),
  );
}

function createBundledSkillHttpsClient(skillId, deps = {}) {
  const normalizedSkillId = String(skillId || "").trim();
  const policy = normalizePolicy(normalizedSkillId);
  const https = deps.https || nodeHttps;
  const auditSink = deps.auditSink || defaultAuditSink;
  const maxRequestBytes = positiveInteger(
    deps.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
  );
  const maxResponseBytes = positiveInteger(
    deps.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const timeoutMs = positiveInteger(
    deps.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const validatedLookup = createValidatedLookup({
    allowedDomains: policy.allowedDomains,
    allowPrivateNetwork: false,
    lookup: deps.lookup,
  });

  function request(input, options, callback) {
    const parsed = parseRequestArguments(input, options, callback);
    const method = String(parsed.options.method || "GET").toUpperCase();
    const auditBase = Object.freeze({
      skillId: normalizedSkillId,
      method,
      hostname: parsed.url.hostname,
      port: parsed.url.port ? Number(parsed.url.port) : 443,
    });
    try {
      assertRequestAllowed(
        normalizedSkillId,
        policy,
        parsed.url,
        parsed.options,
      );
    } catch (error) {
      emitAudit(auditSink, auditBase, "denied", error.code || "policy_denied");
      throw error;
    }
    emitAudit(auditSink, auditBase, "allowed");

    const safeOptions = {
      ...parsed.options,
      protocol: "https:",
      hostname: parsed.url.hostname,
      port: 443,
      path: `${parsed.url.pathname}${parsed.url.search}`,
      rejectUnauthorized: true,
      servername: parsed.url.hostname,
    };
    delete safeOptions.host;
    delete safeOptions.socketPath;
    delete safeOptions.createConnection;
    delete safeOptions.agent;

    let req;
    const recordViolation = (error) =>
      emitAudit(auditSink, auditBase, "blocked", error.code);
    let lookupDenied = false;
    safeOptions.lookup = (hostname, lookupOptions, lookupCallback) =>
      validatedLookup(hostname, lookupOptions, (error, ...records) => {
        if (error && !lookupDenied) {
          lookupDenied = true;
          try {
            emitAudit(
              auditSink,
              auditBase,
              "denied",
              error.code || "dns_denied",
            );
          } catch (auditError) {
            lookupCallback(auditError);
            return;
          }
        }
        lookupCallback(error, ...records);
      });
    const onResponse = (res) => {
      enforceResponseLimit(res, req, maxResponseBytes, recordViolation);
      parsed.callback?.(res);
    };
    req = https.request(safeOptions, onResponse);
    enforceRequestLimit(req, maxRequestBytes, recordViolation);
    req.setTimeout?.(timeoutMs, () => {
      const error = brokerError(
        "CC_BUNDLED_SKILL_EGRESS_TIMEOUT",
        "Bundled Skill HTTPS request timed out",
      );
      recordViolation(error);
      req.destroy?.(error);
    });
    return req;
  }

  function get(input, options, callback) {
    const req = request(input, options, callback);
    req.end();
    return req;
  }

  return Object.freeze({ get, request });
}

module.exports = {
  BUNDLED_SKILL_EGRESS_POLICIES,
  createBundledSkillHttpsClient,
};
