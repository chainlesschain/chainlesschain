"use strict";

/**
 * Loopback-only HTTP broker for reviewed bundled Skill services.
 *
 * The trusted host binds a Skill to one explicit loopback port and authority
 * decision. Handlers can only call reviewed method/path pairs and cannot
 * choose a hostname, port, redirect target, socket, agent, or DNS resolver.
 */

const nodeHttp = require("node:http");
const { logger } = require("../../../utils/logger.js");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const BUNDLED_SKILL_LOCAL_SERVICE_POLICIES = Object.freeze({
  "free-model-manager": Object.freeze({
    serviceId: "ollama",
    maxTimeoutMs: 10 * 60 * 1000,
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    routes: Object.freeze({
      "/api/delete": Object.freeze(["DELETE"]),
      "/api/pull": Object.freeze(["POST"]),
      "/api/show": Object.freeze(["POST"]),
      "/api/tags": Object.freeze(["GET"]),
    }),
  }),
  "image-generator": Object.freeze({
    serviceId: "stable-diffusion",
    maxTimeoutMs: 2 * 60 * 1000,
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 32 * 1024 * 1024,
    routes: Object.freeze({
      "/sdapi/v1/txt2img": Object.freeze(["POST"]),
    }),
  }),
});

const localServiceBrokerMetadata = new WeakMap();

function localBrokerError(code, message) {
  const error = new Error(message);
  error.name = "BundledSkillLocalServiceError";
  error.code = code;
  return error;
}

function positiveInteger(value, fallback, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, maximum);
}

function normalizePolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_POLICY_INVALID",
      "Local service broker requires an explicit host policy",
    );
  }
  const skillId = String(options.skillId || "").trim();
  const reviewed = BUNDLED_SKILL_LOCAL_SERVICE_POLICIES[skillId];
  if (!reviewed || options.serviceId !== reviewed.serviceId) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_SERVICE_DENIED",
      `Bundled Skill ${skillId || "unknown"} has no reviewed local service policy`,
    );
  }
  const authorityId = String(options.authorityId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authorityId)) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_AUTHORITY_REQUIRED",
      "Local service broker requires a stable authority decision ID",
    );
  }
  let baseUrl;
  try {
    baseUrl = new URL(String(options.baseUrl || ""));
  } catch {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_URL_INVALID",
      "Local service broker requires a valid loopback base URL",
    );
  }
  const hostname = baseUrl.hostname.toLowerCase();
  if (
    baseUrl.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_TARGET_DENIED",
      "Local service broker only permits a bare HTTP loopback origin",
    );
  }
  const port = Number(baseUrl.port);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_PORT_DENIED",
      "Local service broker requires an explicit unprivileged service port",
    );
  }
  return Object.freeze({
    authorityId,
    baseUrl: `http://${hostname}:${port}/`,
    connectHost: hostname === "[::1]" ? "::1" : "127.0.0.1",
    port,
    skillId,
    ...reviewed,
  });
}

function defaultAuditSink(event) {
  logger.info(`[BundledSkillLocalService] ${JSON.stringify(event)}`);
}

function emitAudit(auditSink, base, outcome, reason = null) {
  auditSink(
    Object.freeze({
      event: "bundled-skill-local-service",
      timestamp: new Date().toISOString(),
      ...base,
      outcome,
      ...(reason ? { reason } : {}),
    }),
  );
}

function normalizeRequest(policy, requestOptions) {
  if (
    !requestOptions ||
    typeof requestOptions !== "object" ||
    Array.isArray(requestOptions)
  ) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_REQUEST_INVALID",
      "Local service broker requires request options",
    );
  }
  let target;
  try {
    target = new URL(String(requestOptions.path || ""), policy.baseUrl);
  } catch {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_ROUTE_DENIED",
      "Local service broker requires a reviewed relative route",
    );
  }
  const method = String(requestOptions.method || "GET").toUpperCase();
  const allowedMethods = policy.routes[target.pathname];
  if (
    target.origin !== new URL(policy.baseUrl).origin ||
    target.search ||
    target.hash ||
    !allowedMethods?.includes(method)
  ) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_ROUTE_DENIED",
      `Local service ${policy.serviceId} does not permit ${method} ${target.pathname}`,
    );
  }
  let body = null;
  if (requestOptions.body != null) {
    body = Buffer.from(
      typeof requestOptions.body === "string"
        ? requestOptions.body
        : JSON.stringify(requestOptions.body),
      "utf8",
    );
  }
  if (
    body &&
    body.byteLength > (policy.maxRequestBytes || DEFAULT_MAX_REQUEST_BYTES)
  ) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_REQUEST_TOO_LARGE",
      "Local service request exceeds the reviewed byte limit",
    );
  }
  return {
    body,
    maxResponseBytes: positiveInteger(
      requestOptions.maxResponseBytes,
      policy.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES,
      policy.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES,
    ),
    method,
    pathname: target.pathname,
    timeoutMs: positiveInteger(
      requestOptions.timeout,
      DEFAULT_TIMEOUT_MS,
      policy.maxTimeoutMs,
    ),
  };
}

function createBundledSkillLocalServiceBroker(options, deps = {}) {
  const policy = normalizePolicy(options);
  const http = deps.http || nodeHttp;
  const auditSink = deps.auditSink || defaultAuditSink;

  function request(requestOptions) {
    return new Promise((resolve, reject) => {
      let normalized;
      try {
        normalized = normalizeRequest(policy, requestOptions);
      } catch (error) {
        try {
          emitAudit(
            auditSink,
            Object.freeze({
              authorityId: policy.authorityId,
              skillId: policy.skillId,
              serviceId: policy.serviceId,
              port: policy.port,
            }),
            "denied",
            error.code || "policy_denied",
          );
          reject(error);
        } catch (auditError) {
          reject(auditError);
        }
        return;
      }
      const auditBase = Object.freeze({
        authorityId: policy.authorityId,
        skillId: policy.skillId,
        serviceId: policy.serviceId,
        method: normalized.method,
        route: normalized.pathname,
        port: policy.port,
      });
      try {
        emitAudit(auditSink, auditBase, "allowed");
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };
      const startedAt = Date.now();
      let req;
      try {
        req = http.request(
          {
            protocol: "http:",
            hostname: policy.connectHost,
            port: policy.port,
            path: normalized.pathname,
            method: normalized.method,
            agent: false,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "Content-Length": normalized.body?.byteLength || 0,
              "User-Agent": "ChainlessChain-LocalService/1.0",
            },
          },
          (res) => {
            const chunks = [];
            let receivedBytes = 0;
            res.on("data", (chunk) => {
              const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(String(chunk));
              receivedBytes += buffer.byteLength;
              if (receivedBytes > normalized.maxResponseBytes) {
                const error = localBrokerError(
                  "CC_BUNDLED_SKILL_LOCAL_RESPONSE_TOO_LARGE",
                  "Local service response exceeds the reviewed byte limit",
                );
                try {
                  emitAudit(auditSink, auditBase, "blocked", error.code);
                } catch (auditError) {
                  res.destroy?.(auditError);
                  req.destroy?.(auditError);
                  finish(reject, auditError);
                  return;
                }
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
                headers: Object.freeze({ ...(res.headers || {}) }),
                body: Buffer.concat(chunks).toString("utf8"),
                duration: Date.now() - startedAt,
              }),
            );
          },
        );
      } catch (error) {
        finish(reject, error);
        return;
      }
      req.on?.("error", (error) => finish(reject, error));
      req.setTimeout?.(normalized.timeoutMs, () => {
        const error = localBrokerError(
          "CC_BUNDLED_SKILL_LOCAL_TIMEOUT",
          "Local service request timed out",
        );
        try {
          emitAudit(auditSink, auditBase, "blocked", error.code);
        } catch (auditError) {
          finish(reject, auditError);
          req.destroy?.(auditError);
          return;
        }
        req.destroy?.(error);
        finish(reject, error);
      });
      req.end(normalized.body || undefined);
    });
  }

  const broker = Object.freeze({ request });
  localServiceBrokerMetadata.set(broker, policy);
  return broker;
}

function requireBundledSkillLocalServiceBroker(context, skillId, serviceId) {
  const broker = context?.localServiceBroker;
  const metadata =
    broker && typeof broker === "object"
      ? localServiceBrokerMetadata.get(broker)
      : undefined;
  if (!metadata || typeof broker.request !== "function") {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_BROKER_UNAVAILABLE",
      "Trusted local service broker is unavailable; raw loopback HTTP is disabled",
    );
  }
  if (metadata.skillId !== skillId || metadata.serviceId !== serviceId) {
    throw localBrokerError(
      "CC_BUNDLED_SKILL_LOCAL_AUTHORITY_MISMATCH",
      `Local service broker is not scoped to ${skillId}/${serviceId}`,
    );
  }
  return broker;
}

module.exports = {
  BUNDLED_SKILL_LOCAL_SERVICE_POLICIES,
  createBundledSkillLocalServiceBroker,
  requireBundledSkillLocalServiceBroker,
};
