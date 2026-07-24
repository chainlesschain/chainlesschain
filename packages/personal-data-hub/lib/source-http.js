"use strict";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_COOKIE_BYTES = 64 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Build the constrained HTTPS/JSON transport used by source adapters.
 *
 * Adapter fetch seams accept a structured request instead of the WHATWG fetch
 * signature. Keeping the conversion here gives CLI and Electron the same
 * timeout, response-size, cookie, error, and JSON parsing behavior.
 */
function createJsonSourceFetch(opts = {}) {
  const fetchImpl =
    typeof opts.fetchImpl === "function" ? opts.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("createJsonSourceFetch: fetch implementation unavailable");
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

  return async function jsonSourceFetch(request = {}) {
    if (!request || typeof request !== "object") {
      throw new Error("jsonSourceFetch: request object required");
    }
    const url = buildSourceUrl(request, { allowHttp });
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
      timedOut = true;
      controller.abort(
        new Error(`source request timed out after ${timeoutMs}ms`),
      );
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
        { allowHttp, maxRedirects },
      );
      assertHttpsUrl(response.url || url.href, allowHttp);

      if (!response.ok) {
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
      if (text.trim().length === 0) {
        throw sourceHttpError(
          "source returned an empty response",
          "SOURCE_EMPTY_RESPONSE",
          response.status,
        );
      }

      try {
        return JSON.parse(text);
      } catch (cause) {
        const contentType = response.headers.get("content-type") || "unknown";
        const error = sourceHttpError(
          `source response is not JSON (content-type: ${contentType})`,
          "SOURCE_RESPONSE_NOT_JSON",
          response.status,
        );
        error.cause = cause;
        throw error;
      }
    } catch (error) {
      if (timedOut) {
        const timeoutError = sourceHttpError(
          `source request timed out after ${timeoutMs}ms`,
          "SOURCE_REQUEST_TIMEOUT",
          null,
        );
        timeoutError.cause = error;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      detachAbort();
    }
  };
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
    const response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
    });
    if (response.url) {
      const effectiveUrl = new URL(response.url);
      assertHttpsUrl(effectiveUrl, opts.allowHttp);
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

    const nextUrl = new URL(location, url);
    assertHttpsUrl(nextUrl, opts.allowHttp);
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

function buildSourceUrl(request, opts = {}) {
  if (typeof request.url !== "string" || request.url.length === 0) {
    throw new Error("jsonSourceFetch: request.url required");
  }
  const url = new URL(request.url);
  assertHttpsUrl(url, opts.allowHttp === true);
  appendQuery(url.searchParams, request.query);
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
  const url = value instanceof URL ? value : new URL(value);
  const allowed =
    url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  if (!allowed || url.username || url.password) {
    throw new Error("jsonSourceFetch: only credential-free HTTPS URLs allowed");
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

function sourceHttpError(message, code, status) {
  const error = new Error(message);
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
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_COOKIE_BYTES,
  DEFAULT_MAX_REDIRECTS,
  createJsonSourceFetch,
  buildSourceUrl,
};
