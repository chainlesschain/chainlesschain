"use strict";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_COOKIE_BYTES = 64 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const SOURCE_HTTP_ERROR_MARKER = Symbol("sourceHttpError");
const REQUEST_BODY_TIMEOUT = Symbol("requestBodyTimeout");
const REQUEST_BODY_ABORTED = Symbol("requestBodyAborted");

/**
 * Build the constrained HTTPS/JSON transport used by source adapters.
 *
 * Adapter fetch seams accept a structured request instead of the WHATWG fetch
 * signature. Keeping the conversion here gives CLI and Electron the same
 * timeout, response-size, cookie, error, and JSON parsing behavior.
 */
function createJsonSourceFetch(opts = {}) {
  const jsonTransport = createJsonTransport(
    { ...opts, preserveHttpErrorResponse: false },
    "createJsonSourceFetch",
  );

  return async function jsonSourceFetch(request = {}) {
    const result = await jsonTransport(request);
    return result.data;
  };
}

/**
 * Build the constrained transport for clients whose dependency seam follows
 * WHATWG fetch(url | Request, init) and expects a Response.
 *
 * Unlike createJsonSourceFetch, this compatibility layer requires an explicit
 * host-suffix allowlist and default protocol ports. Response bodies are
 * bounded before a fresh Response is returned. Successful responses must be
 * JSON; bounded non-2xx responses are preserved for legacy clients that
 * inspect status and error bodies themselves.
 */
function createJsonResponseSourceFetch(opts = {}) {
  const allowedHostSuffixes = normalizeAllowedHostSuffixes(
    opts.allowedHostSuffixes,
    {
      required: true,
      factoryName: "createJsonResponseSourceFetch",
    },
  );
  if (
    typeof globalThis.Request !== "function" ||
    typeof globalThis.Response !== "function"
  ) {
    throw new Error(
      "createJsonResponseSourceFetch: WHATWG Request/Response unavailable",
    );
  }
  const allowHttp = opts.allowHttp === true;
  const timeoutMs = positiveInteger(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxRequestBytes = positiveInteger(
    opts.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
  );
  const jsonTransport = createJsonTransport(
    {
      ...opts,
      allowedHostSuffixes,
      preserveHttpErrorResponse: true,
      requireDefaultPort: true,
    },
    "createJsonResponseSourceFetch",
  );

  return async function jsonResponseSourceFetch(input, init) {
    const request = await normalizeWhatwgRequest(input, init, {
      allowHttp,
      allowedHostSuffixes,
      maxRequestBytes,
      requireDefaultPort: true,
      timeoutMs,
    });
    const result = await jsonTransport(request);
    const headers = new Headers(result.headers);
    // The original body has already been decoded and buffered. Do not retain
    // wire-level metadata that may no longer describe the rebuilt Response.
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    const body =
      result.text.length === 0 || isNullBodyStatus(result.status)
        ? null
        : result.text;
    return new Response(body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  };
}

function createJsonTransport(opts, factoryName) {
  const fetchImpl =
    typeof opts.fetchImpl === "function" ? opts.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(`${factoryName}: fetch implementation unavailable`);
  }
  const timeoutMs = positiveInteger(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = positiveInteger(
    opts.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const maxCookieBytes = positiveInteger(
    opts.maxCookieBytes,
    DEFAULT_MAX_COOKIE_BYTES,
  );
  const maxRedirects = nonNegativeInteger(
    opts.maxRedirects,
    DEFAULT_MAX_REDIRECTS,
  );
  const allowHttp = opts.allowHttp === true;
  const preserveHttpErrorResponse = opts.preserveHttpErrorResponse === true;
  const requireDefaultPort = opts.requireDefaultPort === true;
  const allowedHostSuffixes = normalizeAllowedHostSuffixes(
    opts.allowedHostSuffixes,
    { factoryName },
  );

  return async function jsonTransport(request = {}) {
    if (!request || typeof request !== "object") {
      throw new Error("jsonSourceFetch: request object required");
    }
    const url = buildSourceUrl(request, {
      allowHttp,
      allowedHostSuffixes,
      requireDefaultPort,
    });
    const headers = new Headers(request.headers || {});
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (!headers.has("user-agent")) {
      headers.set(
        "user-agent",
        "ChainlessChain-PersonalDataHub/1.0 (+local-user-authorized-collector)",
      );
    }
    if (
      typeof request.cookies === "string" &&
      request.cookies.length > 0 &&
      !headers.has("cookie")
    ) {
      headers.set("cookie", request.cookies);
    }
    const cookieHeader = headers.get("cookie");
    if (
      cookieHeader != null &&
      Buffer.byteLength(cookieHeader, "utf8") > maxCookieBytes
    ) {
      throw sourceHttpError(
        `source cookie exceeds ${maxCookieBytes} bytes`,
        "SOURCE_COOKIE_TOO_LARGE",
        null,
      );
    }

    let body = request.body;
    if (request.form != null) {
      if (body != null) {
        throw new Error(
          "jsonSourceFetch: request.body and request.form are mutually exclusive",
        );
      }
      if (
        !(request.form instanceof URLSearchParams) &&
        (typeof request.form !== "object" || Array.isArray(request.form))
      ) {
        throw new Error(
          "jsonSourceFetch: request.form must be an object or URLSearchParams",
        );
      }
      body =
        request.form instanceof URLSearchParams
          ? new URLSearchParams(request.form)
          : buildFormBody(request.form);
      if (!headers.has("content-type")) {
        headers.set(
          "content-type",
          "application/x-www-form-urlencoded;charset=UTF-8",
        );
      }
    }
    if (
      body != null &&
      typeof body === "object" &&
      !(body instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(body) &&
      !(body instanceof URLSearchParams) &&
      !(typeof Blob !== "undefined" && body instanceof Blob) &&
      !(typeof FormData !== "undefined" && body instanceof FormData)
    ) {
      body = JSON.stringify(body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }

    const controller = new AbortController();
    const detachAbort = forwardAbort(request.signal, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        timedOut = true;
        controller.abort(
          new Error(`source request timed out after ${timeoutMs}ms`),
        );
      }
    }, timeoutMs);

    try {
      const method = String(
        request.method || (body == null ? "GET" : "POST"),
      ).toUpperCase();
      const response = await fetchWithConstrainedRedirects(
        fetchImpl,
        url,
        {
          method,
          headers,
          ...(body == null ? {} : { body }),
          signal: controller.signal,
        },
        {
          allowHttp,
          allowedHostSuffixes,
          maxRedirects,
          requireDefaultPort,
        },
      );
      assertHttpsUrl(response.url || url.href, allowHttp);
      assertAllowedHost(response.url || url.href, allowedHostSuffixes);
      if (requireDefaultPort) {
        assertDefaultProtocolPort(response.url || url.href);
      }

      if (!response.ok && !preserveHttpErrorResponse) {
        await cancelResponseBody(response);
        throw sourceHttpError(
          `source request failed with HTTP ${response.status}`,
          "SOURCE_HTTP_ERROR",
          response.status,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxResponseBytes
      ) {
        await cancelResponseBody(response);
        throw sourceHttpError(
          `source response exceeds ${maxResponseBytes} bytes`,
          "SOURCE_RESPONSE_TOO_LARGE",
          response.status,
        );
      }

      const text = await readBoundedResponseText(response, maxResponseBytes);
      const responseResult = {
        data: null,
        text,
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      };
      if (!response.ok) return responseResult;

      if (text.trim().length === 0) {
        throw sourceHttpError(
          "source returned an empty response",
          "SOURCE_EMPTY_RESPONSE",
          response.status,
        );
      }

      try {
        responseResult.data = JSON.parse(text);
        return responseResult;
      } catch (_cause) {
        throw sourceHttpError(
          "source response is not JSON",
          "SOURCE_RESPONSE_NOT_JSON",
          response.status,
        );
      }
    } catch (error) {
      if (timedOut) {
        throw sourceHttpError(
          `source request timed out after ${timeoutMs}ms`,
          "SOURCE_REQUEST_TIMEOUT",
          null,
        );
      }
      if (request.signal && request.signal.aborted) {
        throwAbortReason(request.signal);
      }
      if (isSourceHttpError(error)) throw error;
      throw sourceHttpError(
        "source request failed",
        "SOURCE_REQUEST_FAILED",
        null,
      );
    } finally {
      clearTimeout(timer);
      detachAbort();
    }
  };
}

async function normalizeWhatwgRequest(input, init, opts) {
  const inputUrl = parseWhatwgInputUrl(input);
  assertHttpsUrl(inputUrl, opts.allowHttp);
  assertAllowedHost(inputUrl, opts.allowedHostSuffixes);
  if (opts.requireDefaultPort) assertDefaultProtocolPort(inputUrl);

  let request;
  try {
    request = new Request(input, init);
  } catch (_error) {
    throw new Error("jsonResponseSourceFetch: valid Request required");
  }

  const requestUrl = parseSourceUrl(request.url);
  assertHttpsUrl(requestUrl, opts.allowHttp);
  assertAllowedHost(requestUrl, opts.allowedHostSuffixes);
  if (opts.requireDefaultPort) assertDefaultProtocolPort(requestUrl);
  const normalized = {
    url: requestUrl.href,
    method: request.method,
    headers: new Headers(request.headers),
    signal: request.signal,
  };
  if (request.body != null) {
    normalized.body = await readBoundedRequestBody(request, {
      maxRequestBytes: opts.maxRequestBytes,
      timeoutMs: opts.timeoutMs,
    });
  }
  return normalized;
}

function parseWhatwgInputUrl(input) {
  if (
    typeof input === "string" ||
    (typeof URL === "function" && input instanceof URL)
  ) {
    return parseSourceUrl(String(input));
  }
  if (input && typeof input === "object" && typeof input.url === "string") {
    return parseSourceUrl(input.url);
  }
  throw new Error(
    "jsonResponseSourceFetch: input must be a URL or WHATWG Request",
  );
}

async function fetchWithConstrainedRedirects(
  fetchImpl,
  initialUrl,
  init,
  opts,
) {
  let url = initialUrl;
  let redirects = 0;
  while (true) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: "manual",
      });
    } catch (error) {
      // The outer transport distinguishes caller aborts and timeouts. Every
      // other implementation error is replaced here so URL/header details
      // from a custom fetch seam cannot escape through its error object.
      if (init.signal && init.signal.aborted) throw error;
      throw sourceHttpError(
        "source request failed",
        "SOURCE_REQUEST_FAILED",
        null,
      );
    }
    if (response.url) {
      let effectiveUrl;
      try {
        effectiveUrl = parseSourceUrl(response.url);
        assertHttpsUrl(effectiveUrl, opts.allowHttp);
        assertAllowedHost(effectiveUrl, opts.allowedHostSuffixes);
        if (opts.requireDefaultPort) {
          assertDefaultProtocolPort(effectiveUrl);
        }
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
      if (effectiveUrl.origin !== url.origin) {
        await cancelResponseBody(response);
        throw sourceHttpError(
          "source response changed origin",
          "SOURCE_REDIRECT_NOT_ALLOWED",
          response.status,
        );
      }
    }
    if (!isRedirectStatus(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) {
      await cancelResponseBody(response);
      throw sourceHttpError(
        "source redirect is missing a Location header",
        "SOURCE_REDIRECT_INVALID",
        response.status,
      );
    }
    if (init.method !== "GET" && init.method !== "HEAD") {
      await cancelResponseBody(response);
      throw sourceHttpError(
        "source redirects are allowed only for GET or HEAD requests",
        "SOURCE_REDIRECT_NOT_ALLOWED",
        response.status,
      );
    }
    if (redirects >= opts.maxRedirects) {
      await cancelResponseBody(response);
      throw sourceHttpError(
        `source exceeded ${opts.maxRedirects} redirects`,
        "SOURCE_TOO_MANY_REDIRECTS",
        response.status,
      );
    }

    let nextUrl;
    try {
      nextUrl = new URL(location, url);
    } catch (_error) {
      await cancelResponseBody(response);
      throw sourceHttpError(
        "source redirect has an invalid Location header",
        "SOURCE_REDIRECT_INVALID",
        response.status,
      );
    }
    try {
      assertHttpsUrl(nextUrl, opts.allowHttp);
      assertAllowedHost(nextUrl, opts.allowedHostSuffixes);
      if (opts.requireDefaultPort) assertDefaultProtocolPort(nextUrl);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    if (nextUrl.origin !== url.origin) {
      await cancelResponseBody(response);
      throw sourceHttpError(
        "source redirect changed origin",
        "SOURCE_REDIRECT_NOT_ALLOWED",
        response.status,
      );
    }
    await cancelResponseBody(response);
    url = nextUrl;
    redirects += 1;
  }
}

async function readBoundedRequestBody(request, opts) {
  const body = request.body;
  if (!body || typeof body.getReader !== "function") {
    throw sourceHttpError(
      "source request body stream is unsupported",
      "SOURCE_REQUEST_BODY_UNSUPPORTED",
      null,
    );
  }

  const reader = body.getReader();
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > opts.maxRequestBytes
  ) {
    cancelReader(reader);
    releaseReader(reader);
    throw sourceHttpError(
      `source request exceeds ${opts.maxRequestBytes} bytes`,
      "SOURCE_REQUEST_TOO_LARGE",
      null,
    );
  }
  if (request.signal && request.signal.aborted) {
    cancelReader(reader);
    releaseReader(reader);
    throwAbortReason(request.signal);
  }

  let rejectStop;
  let timer;
  let detachAbort = () => {};
  const stop = new Promise((_resolve, reject) => {
    rejectStop = reject;
  });
  if (request.signal && typeof request.signal.addEventListener === "function") {
    const abort = () => rejectStop(REQUEST_BODY_ABORTED);
    request.signal.addEventListener("abort", abort, { once: true });
    detachAbort = () => request.signal.removeEventListener("abort", abort);
  }
  timer = setTimeout(() => rejectStop(REQUEST_BODY_TIMEOUT), opts.timeoutMs);

  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      byteLength += chunk.byteLength;
      if (byteLength > opts.maxRequestBytes) {
        cancelReader(reader);
        throw sourceHttpError(
          `source request exceeds ${opts.maxRequestBytes} bytes`,
          "SOURCE_REQUEST_TOO_LARGE",
          null,
        );
      }
      chunks.push(
        Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
    }
    return Buffer.concat(chunks, byteLength);
  } catch (error) {
    cancelReader(reader);
    if (error === REQUEST_BODY_TIMEOUT) {
      throw sourceHttpError(
        `source request timed out after ${opts.timeoutMs}ms`,
        "SOURCE_REQUEST_TIMEOUT",
        null,
      );
    }
    if (error === REQUEST_BODY_ABORTED) {
      throwAbortReason(request.signal);
    }
    if (isSourceHttpError(error)) throw error;
    throw sourceHttpError(
      "source request body could not be read",
      "SOURCE_REQUEST_FAILED",
      null,
    );
  } finally {
    clearTimeout(timer);
    detachAbort();
    releaseReader(reader);
  }
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === "function") {
      cancellation.catch(() => {});
    }
  } catch (_error) {
    // Cancellation is cleanup only; retain the bounded/abort error.
  }
}

function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch (_error) {
    // A pending read may retain the lock briefly after cancellation.
  }
}

async function readBoundedResponseText(response, maxResponseBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      throw sourceHttpError(
        `source response exceeds ${maxResponseBytes} bytes`,
        "SOURCE_RESPONSE_TOO_LARGE",
        response.status,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      byteLength += chunk.byteLength;
      if (byteLength > maxResponseBytes) {
        try {
          await reader.cancel();
        } catch (_error) {
          // Preserve the bounded-response error if cancellation itself fails.
        }
        throw sourceHttpError(
          `source response exceeds ${maxResponseBytes} bytes`,
          "SOURCE_RESPONSE_TOO_LARGE",
          response.status,
        );
      }
      chunks.push(
        Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

async function cancelResponseBody(response) {
  if (!response || !response.body) return;
  try {
    await response.body.cancel();
  } catch (_error) {
    // Cancellation is cleanup only; retain the transport's primary error.
  }
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isNullBodyStatus(status) {
  return [101, 204, 205, 304].includes(status);
}

function buildSourceUrl(request, opts = {}) {
  if (typeof request.url !== "string" || request.url.length === 0) {
    throw new Error("jsonSourceFetch: request.url required");
  }
  const url = parseSourceUrl(request.url);
  assertHttpsUrl(url, opts.allowHttp === true);
  assertAllowedHost(url, opts.allowedHostSuffixes);
  if (opts.requireDefaultPort) assertDefaultProtocolPort(url);
  appendQuery(url.searchParams, request.query);
  // Some official APIs (for example Baidu Netdisk) require OAuth credentials
  // as URL parameters. Keep those values in a separately named request field
  // so adapters do not accidentally mix them into ordinary pagination
  // telemetry. The transport never includes the resulting URL in errors.
  appendQuery(url.searchParams, request.credentialQuery);
  appendSignedValue(url.searchParams, "sign", request.sign);
  appendSignedValue(url.searchParams, "anti_token", request.antiToken);
  return url;
}

function appendQuery(searchParams, query) {
  if (!query || typeof query !== "object") return;
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) appendQueryValue(searchParams, key, entry);
    } else {
      appendQueryValue(searchParams, key, value);
    }
  }
}

function buildFormBody(form) {
  const body = new URLSearchParams();
  appendQuery(body, form);
  return body;
}

function appendSignedValue(searchParams, key, value) {
  if (value == null || value === "") return;
  if (typeof value === "object" && !Array.isArray(value)) {
    appendQuery(searchParams, value);
    return;
  }
  appendQueryValue(searchParams, key, value);
}

function appendQueryValue(searchParams, key, value) {
  searchParams.append(
    key,
    typeof value === "object" ? JSON.stringify(value) : String(value),
  );
}

function assertHttpsUrl(value, allowHttp) {
  const url = value instanceof URL ? value : parseSourceUrl(value);
  const allowed =
    url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  if (!allowed || url.username || url.password) {
    throw new Error("jsonSourceFetch: only credential-free HTTPS URLs allowed");
  }
}

function assertDefaultProtocolPort(value) {
  const url = value instanceof URL ? value : parseSourceUrl(value);
  // URL normalizes explicit default ports (:443 for HTTPS, :80 for HTTP) to
  // an empty string. Any remaining port is therefore non-default.
  if (url.port !== "") {
    throw sourceHttpError(
      "source URL must use the default protocol port",
      "SOURCE_PORT_NOT_ALLOWED",
      null,
    );
  }
}

function assertAllowedHost(value, allowedHostSuffixes) {
  if (!allowedHostSuffixes) return;
  const url = value instanceof URL ? value : parseSourceUrl(value);
  const host = normalizeHostname(url.hostname);
  const allowed = allowedHostSuffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!allowed) {
    throw sourceHttpError(
      "source host is not allowed",
      "SOURCE_HOST_NOT_ALLOWED",
      null,
    );
  }
}

function normalizeAllowedHostSuffixes(value, opts = {}) {
  if (value == null) {
    if (opts.required) {
      throw new Error(
        `${opts.factoryName || "source transport"}: allowedHostSuffixes required`,
      );
    }
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `${opts.factoryName || "source transport"}: allowedHostSuffixes must be a non-empty array`,
    );
  }

  const normalized = [];
  for (const entry of value) {
    const suffix = normalizeHostSuffix(entry);
    if (!normalized.includes(suffix)) normalized.push(suffix);
  }
  return Object.freeze(normalized);
}

function normalizeHostSuffix(value) {
  if (typeof value !== "string") {
    throw new Error(
      "source transport: allowedHostSuffixes contains an invalid host",
    );
  }
  let candidate = value.trim().toLowerCase();
  if (candidate.startsWith(".")) candidate = candidate.slice(1);
  if (
    !candidate ||
    candidate.includes(":") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes("@") ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    throw new Error(
      "source transport: allowedHostSuffixes contains an invalid host",
    );
  }

  let parsed;
  try {
    parsed = new URL(`https://${candidate}`);
  } catch (_error) {
    throw new Error(
      "source transport: allowedHostSuffixes contains an invalid host",
    );
  }
  const hostname = normalizeHostname(parsed.hostname);
  const labels = hostname.split(".");
  if (
    !hostname ||
    labels.some(
      (label) =>
        !label ||
        !/^[a-z0-9-]+$/u.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    throw new Error(
      "source transport: allowedHostSuffixes contains an invalid host",
    );
  }
  return hostname;
}

function normalizeHostname(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.$/u, "");
}

function parseSourceUrl(value) {
  try {
    return value instanceof URL ? new URL(value.href) : new URL(value);
  } catch (_error) {
    throw new Error("jsonSourceFetch: valid absolute URL required");
  }
}

function forwardAbort(signal, controller) {
  if (!signal || typeof signal.addEventListener !== "function") {
    return () => {};
  }
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abort();
    return () => {};
  }
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function throwAbortReason(signal) {
  if (signal && signal.reason !== undefined) throw signal.reason;
  throw sourceHttpError(
    "source request was aborted",
    "SOURCE_REQUEST_ABORTED",
    null,
  );
}

function isSourceHttpError(error) {
  return Boolean(error && error[SOURCE_HTTP_ERROR_MARKER] === true);
}

function sourceHttpError(message, code, status) {
  const error = new Error(message);
  Object.defineProperty(error, SOURCE_HTTP_ERROR_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  error.code = code;
  if (status != null) error.status = status;
  return error;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_COOKIE_BYTES,
  DEFAULT_MAX_REDIRECTS,
  createJsonSourceFetch,
  createJsonResponseSourceFetch,
  buildSourceUrl,
};
