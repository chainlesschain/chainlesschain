"use strict";

function hasRuntimeCookie(opts = {}) {
  return typeof opts.cookie === "string" && opts.cookie.trim().length > 0;
}

function hasRuntimeAccountId(opts = {}) {
  return opts.accountId != null && String(opts.accountId).trim().length > 0;
}

function runtimeAccountIdFailure(name) {
  return {
    ok: false,
    reason: "NO_ACCOUNT_ID",
    message: `${name} cookie mode requires opts.accountId for an isolated watermark scope`,
  };
}

function assertRuntimeAccountId(name, opts = {}) {
  if (hasRuntimeCookie(opts) && !hasRuntimeAccountId(opts)) {
    throw new Error(
      `${name}.sync: opts.accountId required for transient cookie collection`,
    );
  }
}

async function healthCheckFromAuthenticate(adapter, opts = {}) {
  const result = await adapter.authenticate(opts);
  return result.ok
    ? { ok: true, lastChecked: Date.now() }
    : {
        ok: false,
        reason: result.reason,
        error: result.error || result.message,
        lastChecked: Date.now(),
      };
}

/**
 * Instrument the exact fetch boundary used by legacy live-cookie clients.
 * A constructor-provided fallback is deliberately authoritative so opaque
 * runtime options cannot replace the gateway's restricted transport.
 *
 * The returned state keeps permit failures outside clients that deliberately
 * translate transport failures into `lastError`; callers invoke
 * `throwIfPermitFailed()` immediately after each high-level client request so
 * registry abort/rate-limit errors retain their original type and metadata.
 */
function createSourceRequestAudit(opts = {}, operation, fallbackFetch = null) {
  const beforeSourceRequest = opts.beforeSourceRequest;
  const fetchImpl =
    typeof fallbackFetch === "function"
      ? fallbackFetch
      : typeof opts.fetch === "function"
        ? opts.fetch
        : typeof globalThis.fetch === "function"
          ? globalThis.fetch.bind(globalThis)
          : null;
  const invokeFetch =
    typeof fetchImpl === "function"
      ? (input, init) =>
          fetchImpl(
            input,
            opts.signal
              ? {
                  ...(init || {}),
                  signal: opts.signal,
                }
              : init,
          )
      : null;
  let permitError = null;
  let request = 0;

  if (
    typeof beforeSourceRequest !== "function" ||
    typeof invokeFetch !== "function"
  ) {
    return {
      fetch: invokeFetch,
      throwIfPermitFailed() {},
    };
  }

  return {
    fetch: async (...args) => {
      if (permitError) throw permitError;
      request += 1;
      try {
        await beforeSourceRequest({ operation, request });
      } catch (error) {
        permitError = error;
        throw error;
      }
      return invokeFetch(...args);
    },
    throwIfPermitFailed() {
      if (permitError) throw permitError;
    },
  };
}

module.exports = {
  assertRuntimeAccountId,
  createSourceRequestAudit,
  hasRuntimeAccountId,
  hasRuntimeCookie,
  healthCheckFromAuthenticate,
  runtimeAccountIdFailure,
};
