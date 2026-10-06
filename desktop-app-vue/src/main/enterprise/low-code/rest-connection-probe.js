"use strict";

const http = require("node:http");
const https = require("node:https");
const { performance } = require("node:perf_hooks");

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 15000;

function invalid(code = "REST_PROBE_INVALID_CONFIG") {
  return {
    success: false,
    status: "invalid-config",
    probed: false,
    errorCode: code,
    error:
      "REST probe requires an HTTP(S) URL without credentials or fragment, and a timeout from 100 to 15000 ms",
  };
}

/** Reachability only: a fixed HEAD request, no body, auth headers, redirects,
 * cookies, proxy environment or application deployment claims. */
async function probeRestConnection(config) {
  let url;
  if (!config || typeof config !== "object" || Array.isArray(config))
    return invalid();
  if (typeof config.url !== "string" || config.url.length > 4096)
    return invalid();
  try {
    url = new URL(config.url);
  } catch {
    return invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    return invalid();
  if (
    config.headers != null ||
    config.auth != null ||
    (config.method != null && config.method !== "HEAD")
  ) {
    return {
      success: false,
      status: "unsupported",
      probed: false,
      errorCode: "REST_PROBE_AUTH_OR_METHOD_UNSUPPORTED",
      error: "This probe supports unauthenticated HEAD requests only",
    };
  }
  if (
    Object.keys(config).some(
      (key) => !["url", "timeoutMs", "method"].includes(key),
    )
  )
    return invalid();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    return invalid();

  const startedAt = performance.now();
  return new Promise((resolve) => {
    let request;
    let finished = false;
    let timer;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ...result,
        probed: true,
        method: "HEAD",
        check: "http-reachability",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    };
    // An overall deadline also bounds DNS/connection establishment, unlike a
    // socket inactivity timeout alone. No retry can duplicate a probe.
    timer = setTimeout(() => {
      finish({
        success: false,
        status: "timeout",
        errorCode: "REST_PROBE_TIMEOUT",
        error: "Connection probe timed out",
      });
      request?.destroy();
    }, timeoutMs);
    try {
      request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: "HEAD",
          agent: false,
          maxHeaderSize: 16384,
          headers: { Accept: "application/json" },
        },
        (response) => {
          const httpStatus = response.statusCode;
          // Never consume or reflect response content or headers.
          response.destroy();
          if (httpStatus >= 200 && httpStatus < 300) {
            finish({ success: true, status: "reachable", httpStatus });
          } else if (httpStatus >= 300 && httpStatus < 400) {
            finish({
              success: false,
              status: "redirect-blocked",
              httpStatus,
              errorCode: "REST_PROBE_REDIRECT_BLOCKED",
              error: "Connection probe does not follow redirects",
            });
          } else {
            finish({
              success: false,
              status: "http-error",
              httpStatus,
              errorCode: "REST_PROBE_HTTP_ERROR",
              error: "Endpoint returned a non-success HTTP status",
            });
          }
        },
      );
      request.on("error", () =>
        finish({
          success: false,
          status: "network-error",
          errorCode: "REST_PROBE_NETWORK_ERROR",
          error: "Connection probe could not reach the endpoint",
        }),
      );
      request.end();
    } catch {
      finish({
        success: false,
        status: "network-error",
        errorCode: "REST_PROBE_NETWORK_ERROR",
        error: "Connection probe could not reach the endpoint",
      });
      request?.destroy();
    }
  });
}

module.exports = { probeRestConnection };
