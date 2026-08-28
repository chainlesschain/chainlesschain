"use strict";

/**
 * HTTPS brokers for package-owned bundled Skills.
 *
 * Bundled handlers receive a Node-compatible `request`/`get` surface, while
 * this module owns domain allowlists, DNS/IP validation, TLS requirements,
 * request/response limits, timeouts, and audit records. No handler can supply
 * a custom lookup/agent/socket or weaken certificate validation.
 */

const nodeHttps = require("node:https");
const nodeNet = require("node:net");
const {
  createValidatedLookup,
  domainAllowed,
} = require("../../../mcp/mcp-egress-policy.js");
const { logger } = require("../../../utils/logger.js");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RUNTIME_DOMAINS = 64;
const MAX_REDIRECTS = 5;
const RUNTIME_BROKER_SKILL_IDS = Object.freeze([
  "api-gateway",
  "http-client",
  "summarizer",
]);
const runtimeBrokerMetadata = new WeakMap();

const BUNDLED_SKILL_EGRESS_POLICIES = Object.freeze({
  "audio-transcriber": Object.freeze({
    allowedDomains: Object.freeze(["api.openai.com"]),
    maxRequestBytes: 26 * 1024 * 1024,
    maxResponseBytes: 2 * 1024 * 1024,
  }),
  "free-model-manager": Object.freeze({
    allowedDomains: Object.freeze(["huggingface.co"]),
    maxRequestBytes: 256 * 1024,
    maxResponseBytes: 4 * 1024 * 1024,
  }),
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
  "image-generator": Object.freeze({
    allowedDomains: Object.freeze(["api.openai.com"]),
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 32 * 1024 * 1024,
  }),
});

function brokerError(code, message) {
  const error = new Error(message);
  error.name = "BundledSkillEgressError";
  error.code = code;
  return error;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }
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

function normalizeSkillId(skillId) {
  const normalized = String(skillId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_SKILL_INVALID",
      "Runtime network broker requires a valid bundled Skill ID",
    );
  }
  if (!RUNTIME_BROKER_SKILL_IDS.includes(normalized)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_SKILL_DENIED",
      `Bundled Skill ${normalized} is not approved for runtime network policy`,
    );
  }
  return normalized;
}

function normalizeAllowedDomain(entry) {
  const candidate = String(entry || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const hostname = candidate;
  const labels = hostname.split(".");
  if (
    !candidate ||
    candidate.includes("*") ||
    candidate.includes(":") ||
    candidate.includes("/") ||
    nodeNet.isIP(hostname) !== 0 ||
    labels.length < 2 ||
    hostname.length > 253 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_DOMAIN_INVALID",
      `Runtime network broker received an invalid domain policy entry: ${candidate || "<empty>"}`,
    );
  }
  return hostname;
}

function normalizeRuntimePolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_POLICY_INVALID",
      "Runtime network broker requires an explicit policy",
    );
  }
  const skillId = normalizeSkillId(options.skillId);
  if (
    !Array.isArray(options.allowedDomains) ||
    options.allowedDomains.length === 0 ||
    options.allowedDomains.length > MAX_RUNTIME_DOMAINS
  ) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_DOMAINS_REQUIRED",
      `Runtime network broker requires 1-${MAX_RUNTIME_DOMAINS} explicit domains`,
    );
  }
  const allowedDomains = Object.freeze(
    [...new Set(options.allowedDomains.map(normalizeAllowedDomain))].sort(),
  );
  const declassificationId = String(options.declassificationId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(declassificationId)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_DECLASSIFICATION_REQUIRED",
      "Runtime network broker requires a stable declassification decision ID",
    );
  }
  return Object.freeze({ skillId, allowedDomains, declassificationId });
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
  if (chunk == null) {
    return 0;
  }
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

function createPolicyHttpsClient(normalizedSkillId, policy, deps = {}) {
  const https = deps.https || nodeHttps;
  const auditSink = deps.auditSink || defaultAuditSink;
  const policyMaxRequestBytes = positiveInteger(
    policy.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
  );
  const policyMaxResponseBytes = positiveInteger(
    policy.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const maxRequestBytes = positiveInteger(
    deps.maxRequestBytes,
    policyMaxRequestBytes,
    policyMaxRequestBytes,
  );
  const maxResponseBytes = positiveInteger(
    deps.maxResponseBytes,
    policyMaxResponseBytes,
    policyMaxResponseBytes,
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
      ...(policy.declassificationId
        ? { declassificationId: policy.declassificationId }
        : {}),
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

    // The response closure needs the request object after https.request returns.
    // eslint-disable-next-line prefer-const
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

function createBundledSkillHttpsClient(skillId, deps = {}) {
  const normalizedSkillId = String(skillId || "").trim();
  return createPolicyHttpsClient(
    normalizedSkillId,
    normalizePolicy(normalizedSkillId),
    deps,
  );
}

function normalizeResponseHeaders(headers) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (value != null) {
      normalized[String(name).toLowerCase()] = value;
    }
  }
  return normalized;
}

function serializeRequestBody(body) {
  if (body == null) {
    return null;
  }
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    return body;
  }
  if (typeof body === "string") {
    return body;
  }
  return JSON.stringify(body);
}

function normalizeRuntimeHeaders(headers, body) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_HEADERS_INVALID",
      "Runtime network request headers must be an object",
    );
  }
  const normalized = { ...headers };
  for (const name of Object.keys(normalized)) {
    const lower = name.toLowerCase();
    if (lower === "transfer-encoding") {
      throw brokerError(
        "CC_BUNDLED_SKILL_NETWORK_HEADER_DENIED",
        "Runtime network request cannot set Transfer-Encoding",
      );
    }
    if (lower === "content-length") {
      delete normalized[name];
    }
  }
  if (body != null) {
    normalized["Content-Length"] = chunkBytes(body);
  }
  return normalized;
}

function headersForRedirect(headers, fromUrl, toUrl) {
  const redirected = { ...(headers || {}) };
  if (fromUrl.origin !== toUrl.origin) {
    for (const name of Object.keys(redirected)) {
      if (
        ["authorization", "cookie", "proxy-authorization"].includes(
          name.toLowerCase(),
        )
      ) {
        delete redirected[name];
      }
    }
  }
  return redirected;
}

function createHighLevelNetworkBroker(policy, deps = {}) {
  function requestOnce({
    url,
    method,
    headers,
    body,
    timeoutMs,
    maxResponseBytes,
  }) {
    return new Promise((resolve, reject) => {
      const client = createPolicyHttpsClient(policy.skillId, policy, {
        ...deps,
        timeoutMs,
      });
      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };
      let req;
      try {
        req = client.request(url, { method, headers }, (res) => {
          const chunks = [];
          let receivedBytes = 0;
          res.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(String(chunk));
            receivedBytes += buffer.byteLength;
            if (receivedBytes > maxResponseBytes) {
              const error = brokerError(
                "CC_BUNDLED_SKILL_NETWORK_RESPONSE_TOO_LARGE",
                "Runtime network response exceeds the approved byte limit",
              );
              res.destroy?.(error);
              req.destroy?.(error);
              finish(reject, error);
              return;
            }
            chunks.push(buffer);
          });
          res.on("error", (error) => finish(reject, error));
          res.on("end", () =>
            finish(resolve, {
              status: Number(res.statusCode || 0),
              statusText: String(res.statusMessage || ""),
              headers: normalizeResponseHeaders(res.headers),
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
      } catch (error) {
        finish(reject, error);
        return;
      }
      req.on?.("error", (error) => finish(reject, error));
      if (body == null) {
        req.end();
      } else {
        req.end(body);
      }
    });
  }

  async function request(requestOptions = {}) {
    if (
      !requestOptions ||
      typeof requestOptions !== "object" ||
      Array.isArray(requestOptions)
    ) {
      throw brokerError(
        "CC_BUNDLED_SKILL_NETWORK_REQUEST_INVALID",
        "Runtime network broker requires request options",
      );
    }
    let currentUrl;
    try {
      currentUrl = new URL(String(requestOptions.url || ""));
    } catch {
      throw brokerError(
        "CC_BUNDLED_SKILL_EGRESS_URL_INVALID",
        "Runtime network broker requires a valid URL",
      );
    }
    let method = String(requestOptions.method || "GET").toUpperCase();
    if (!/^[A-Z]{1,16}$/.test(method)) {
      throw brokerError(
        "CC_BUNDLED_SKILL_NETWORK_METHOD_INVALID",
        "Runtime network request method is invalid",
      );
    }
    let body = serializeRequestBody(requestOptions.body);
    const maxRequestBytes = positiveInteger(
      policy.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
    );
    if (body != null && chunkBytes(body) > maxRequestBytes) {
      throw brokerError(
        "CC_BUNDLED_SKILL_EGRESS_REQUEST_TOO_LARGE",
        "Runtime network request exceeds the approved byte limit",
      );
    }
    let headers = normalizeRuntimeHeaders(requestOptions.headers || {}, body);
    const maxResponseBytes = positiveInteger(
      requestOptions.maxResponseBytes,
      positiveInteger(policy.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
      positiveInteger(policy.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
    );
    const timeoutMs = positiveInteger(
      requestOptions.timeout,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    const startedAt = Date.now();

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await requestOnce({
        url: currentUrl,
        method,
        headers,
        body,
        timeoutMs,
        maxResponseBytes,
      });
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0]
        : response.headers.location;
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        return Object.freeze({
          ...response,
          duration: Date.now() - startedAt,
        });
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw brokerError(
          "CC_BUNDLED_SKILL_NETWORK_REDIRECT_LIMIT",
          `Runtime network request exceeded ${MAX_REDIRECTS} redirects`,
        );
      }
      let redirectedUrl;
      try {
        redirectedUrl = new URL(String(location), currentUrl);
      } catch {
        throw brokerError(
          "CC_BUNDLED_SKILL_NETWORK_REDIRECT_INVALID",
          "Runtime network response supplied an invalid redirect URL",
        );
      }
      headers = headersForRedirect(headers, currentUrl, redirectedUrl);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = null;
        for (const name of Object.keys(headers)) {
          if (["content-length", "content-type"].includes(name.toLowerCase())) {
            delete headers[name];
          }
        }
      }
      currentUrl = redirectedUrl;
    }
  }

  const broker = Object.freeze({ request });
  runtimeBrokerMetadata.set(broker, policy);
  return broker;
}

function createBundledSkillFixedNetworkBroker(skillId, deps = {}) {
  const normalizedSkillId = String(skillId || "").trim();
  const fixedPolicy = normalizePolicy(normalizedSkillId);
  const policy = Object.freeze({
    skillId: normalizedSkillId,
    ...fixedPolicy,
  });
  return createHighLevelNetworkBroker(policy, deps);
}

function createBundledSkillRuntimeNetworkBroker(options, deps = {}) {
  return createHighLevelNetworkBroker(normalizeRuntimePolicy(options), deps);
}

function requireBundledSkillRuntimeNetworkBroker(context, skillId) {
  const broker = context?.networkBroker;
  const metadata =
    broker && typeof broker === "object"
      ? runtimeBrokerMetadata.get(broker)
      : undefined;
  if (!metadata || typeof broker.request !== "function") {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_BROKER_UNAVAILABLE",
      "Trusted runtime network broker is unavailable; raw HTTP execution is disabled",
    );
  }
  if (metadata.skillId !== skillId) {
    throw brokerError(
      "CC_BUNDLED_SKILL_NETWORK_AUTHORITY_MISMATCH",
      `Runtime network broker is scoped to ${metadata.skillId}, not ${skillId}`,
    );
  }
  return broker;
}

module.exports = {
  BUNDLED_SKILL_EGRESS_POLICIES,
  createBundledSkillFixedNetworkBroker,
  createBundledSkillHttpsClient,
  createBundledSkillRuntimeNetworkBroker,
  requireBundledSkillRuntimeNetworkBroker,
};
