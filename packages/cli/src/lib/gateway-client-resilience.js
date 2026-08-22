/**
 * Bounded resilience layer for private Runner / gateway SSE connections.
 *
 * The layer deliberately receives TLS and proxy credentials through callbacks.
 * It never parses certificate/key paths or retains proxy values, so callers
 * can use a managed credential source that is refreshed before every connect.
 */

const MAX_RECONNECT_ATTEMPTS = 8;
const MAX_IDLE_TIMEOUT_MS = 10 * 60_000;
const MIN_IDLE_TIMEOUT_MS = 100;
const MAX_EVENT_ID_BYTES = 256;
const MAX_EVENT_DATA_BYTES = 1024 * 1024;
const MAX_SSE_PENDING_BYTES = MAX_EVENT_DATA_BYTES + 8 * 1024;
const MAX_SSE_FRAME_BYTES = MAX_EVENT_DATA_BYTES + 64 * 1024;
const MAX_SSE_FRAME_LINES = 4096;

function gatewayError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw gatewayError(
      "CC_GATEWAY_OPTIONS_INVALID",
      "gateway option is invalid",
    );
  }
  return number;
}

function safeEventId(value) {
  const id = String(value || "");
  if (
    Buffer.byteLength(id, "utf8") > MAX_EVENT_ID_BYTES ||
    /[\r\n\u0000-\u001f\u007f]/u.test(id)
  ) {
    throw gatewayError(
      "CC_GATEWAY_SSE_EVENT_INVALID",
      "gateway event id is invalid",
    );
  }
  return id;
}

function safeRelativePath(value) {
  const path = String(value || "");
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\?#\r\n\u0000]/u.test(path)
  ) {
    throw gatewayError(
      "CC_GATEWAY_PATH_INVALID",
      "gateway request path is invalid",
    );
  }
  for (const segment of path.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw gatewayError(
        "CC_GATEWAY_PATH_INVALID",
        "gateway request path is invalid",
      );
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      /[\\/\r\n\u0000]/u.test(decoded)
    ) {
      throw gatewayError(
        "CC_GATEWAY_PATH_INVALID",
        "gateway request path is invalid",
      );
    }
  }
  return path;
}

function responseContentType(response) {
  const headers = response?.headers;
  if (headers && typeof headers.get === "function") {
    return String(headers.get("content-type") || "").toLowerCase();
  }
  return "";
}

/**
 * Translate a gateway failure to a small stable vocabulary. Raw upstream
 * messages, URLs, proxy configuration and bodies are intentionally discarded.
 */
export function normalizeGatewayError(errorOrResponse) {
  if (typeof errorOrResponse?.status === "number") {
    const status = errorOrResponse.status;
    if (status === 401 || status === 403) {
      return gatewayError(
        "CC_GATEWAY_UPSTREAM_AUTH_REJECTED",
        "gateway upstream authentication was rejected",
      );
    }
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return gatewayError(
        "CC_GATEWAY_UPSTREAM_UNAVAILABLE",
        "gateway upstream is temporarily unavailable",
      );
    }
    return gatewayError(
      "CC_GATEWAY_UPSTREAM_REJECTED",
      "gateway upstream rejected the request",
    );
  }

  const codes = [
    errorOrResponse?.code,
    errorOrResponse?.cause?.code,
    errorOrResponse?.name,
    errorOrResponse?.cause?.name,
  ].map((value) => String(value || "").toUpperCase());
  if (
    codes.some((code) =>
      ["ABORT_ERR", "ERR_ABORTED", "ABORTERROR"].includes(code),
    )
  ) {
    return gatewayError("CC_GATEWAY_ABORTED", "gateway request was aborted");
  }
  if (
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
    ].some((code) => codes.includes(code))
  ) {
    return gatewayError(
      "CC_GATEWAY_TRANSPORT_UNAVAILABLE",
      "gateway transport is temporarily unavailable",
    );
  }
  return gatewayError(
    "CC_GATEWAY_TRANSPORT_FAILED",
    "gateway transport failed",
  );
}

function isRetryableGatewayError(error) {
  return new Set([
    "CC_GATEWAY_SSE_IDLE_TIMEOUT",
    "CC_GATEWAY_TRANSPORT_UNAVAILABLE",
    "CC_GATEWAY_UPSTREAM_UNAVAILABLE",
  ]).has(error?.code);
}

function parseSseBlock(lines, state, onEvent, onKeepalive) {
  if (lines.length === 0) return;
  let event = "message";
  let id = state.lastEventId;
  const data = [];
  let sawField = false;

  for (const line of lines) {
    if (line.startsWith(":")) {
      onKeepalive?.();
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      event = value || "message";
      sawField = true;
    } else if (field === "id") {
      id = safeEventId(value);
      sawField = true;
    } else if (field === "data") {
      data.push(value);
      sawField = true;
    }
  }
  if (!sawField) return;
  state.lastEventId = id;
  // SSE permits id-only frames to update the replay cursor. They are not
  // application events and must not make consumers process an empty message.
  if (data.length === 0) return;
  const body = data.join("\n");
  if (Buffer.byteLength(body, "utf8") > MAX_EVENT_DATA_BYTES) {
    throw gatewayError(
      "CC_GATEWAY_SSE_EVENT_INVALID",
      "gateway event is too large",
    );
  }
  onEvent?.(Object.freeze({ event, id, data: body }));
}

function invalidSseFrame() {
  return gatewayError(
    "CC_GATEWAY_SSE_FRAME_INVALID",
    "gateway event frame is invalid",
  );
}

function queueSseFrameLine(state, line) {
  const bytes = Buffer.byteLength(line, "utf8");
  if (
    state.frameLineCount >= MAX_SSE_FRAME_LINES ||
    state.frameBytes + bytes > MAX_SSE_FRAME_BYTES
  ) {
    throw invalidSseFrame();
  }
  state.lines.push(line);
  state.frameLineCount += 1;
  state.frameBytes += bytes;
}

function resetSseFrame(state) {
  state.lines = [];
  state.frameLineCount = 0;
  state.frameBytes = 0;
}

function consumeSseChunk(pending, chunk, state, onEvent, onKeepalive) {
  // Measure the only line that can extend `pending` before concatenating or
  // allocating a list of lines. A malicious peer therefore cannot grow an
  // unterminated frame through arbitrarily fragmented chunks.
  const firstNewline = chunk.indexOf("\n");
  const pendingPrefix =
    firstNewline === -1 ? chunk : chunk.slice(0, firstNewline);
  if (
    Buffer.byteLength(pending, "utf8") +
      Buffer.byteLength(pendingPrefix, "utf8") >
    MAX_SSE_PENDING_BYTES
  ) {
    throw invalidSseFrame();
  }

  const buffer = pending + chunk;
  let start = 0;
  for (;;) {
    const newline = buffer.indexOf("\n", start);
    if (newline === -1) return buffer.slice(start);
    const line = buffer.slice(start, newline);
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalized === "") {
      parseSseBlock(state.lines, state, onEvent, onKeepalive);
      resetSseFrame(state);
    } else {
      queueSseFrameLine(state, normalized);
    }
    start = newline + 1;
  }
}

function withIdleDeadline(reader, idleTimeoutMs, deps) {
  let timer = null;
  const idle = new Promise((_, reject) => {
    timer = deps.setTimeout(() => {
      reject(
        gatewayError(
          "CC_GATEWAY_SSE_IDLE_TIMEOUT",
          "gateway event stream became idle",
        ),
      );
      // Reject before resolving cancellation: otherwise a compliant reader
      // can report `done` first and silently turn an idle timeout into a clean
      // EOF, skipping the reconnect path.
      Promise.resolve(reader.cancel?.()).catch(() => {});
    }, idleTimeoutMs);
  });
  return Promise.race([reader.read(), idle]).finally(() => {
    if (timer !== null) deps.clearTimeout(timer);
  });
}

async function consumeSse(response, options, deps) {
  if (!response?.ok) throw normalizeGatewayError(response);
  if (!/^text\/event-stream(?:;|$)/u.test(responseContentType(response))) {
    throw gatewayError(
      "CC_GATEWAY_SSE_CONTENT_TYPE_INVALID",
      "gateway did not return an event stream",
    );
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw gatewayError(
      "CC_GATEWAY_SSE_BODY_INVALID",
      "gateway event stream body is unavailable",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    lines: [],
    frameBytes: 0,
    frameLineCount: 0,
    lastEventId: options.lastEventId || "",
  };
  let pending = "";
  try {
    for (;;) {
      const record = await withIdleDeadline(
        reader,
        options.idleTimeoutMs,
        deps,
      );
      if (record.done) break;
      const chunk = decoder.decode(record.value, { stream: true });
      pending = consumeSseChunk(
        pending,
        chunk,
        state,
        options.onEvent,
        options.onKeepalive,
      );
    }
    pending = consumeSseChunk(
      pending,
      decoder.decode(),
      state,
      options.onEvent,
      options.onKeepalive,
    );
    if (pending) {
      queueSseFrameLine(
        state,
        pending.endsWith("\r") ? pending.slice(0, -1) : pending,
      );
    }
    parseSseBlock(state.lines, state, options.onEvent, options.onKeepalive);
    return Object.freeze({ lastEventId: state.lastEventId, ended: true });
  } catch (error) {
    // Keep the most recently confirmed replay cursor private to this recovery
    // loop. It is never rendered or persisted by the transport layer.
    if (error && typeof error === "object" && state.lastEventId) {
      error.lastEventId = state.lastEventId;
    }
    throw error;
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // A timed-out read may still be settling its cancellation. The stream
      // has already been rejected with the canonical idle error above.
    }
  }
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw gatewayError("CC_GATEWAY_URL_INVALID", "gateway base URL is invalid");
  }
  if (
    !new Set(["https:", "http:"]).has(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw gatewayError("CC_GATEWAY_URL_INVALID", "gateway base URL is invalid");
  }
  return new URL(url.href.replace(/\/+$/u, ""));
}

function safeHeaders(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw gatewayError(
      "CC_GATEWAY_OPTIONS_INVALID",
      "gateway headers are invalid",
    );
  }
  const headers = {};
  for (const [name, entry] of Object.entries(value)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name) ||
      /^(?:proxy-authorization|host|connection)$/iu.test(name) ||
      typeof entry !== "string" ||
      entry.length > 16 * 1024 ||
      /[\r\n\u0000]/u.test(entry)
    ) {
      throw gatewayError(
        "CC_GATEWAY_OPTIONS_INVALID",
        "gateway headers are invalid",
      );
    }
    headers[name] = entry;
  }
  return headers;
}

function transportDispatcher(value) {
  const dispatcher = value?.dispatcher;
  if (
    !dispatcher ||
    (typeof dispatcher !== "object" && typeof dispatcher !== "function") ||
    typeof dispatcher.dispatch !== "function"
  ) {
    throw gatewayError(
      "CC_GATEWAY_OPTIONS_INVALID",
      "gateway transport is invalid",
    );
  }
  return dispatcher;
}

/**
 * A narrow, injected gateway client. TLS and proxy helpers are invoked once per
 * connection attempt, which provides hot rotation without retaining secrets.
 *
 * Providers return a `{ dispatcher }` capability rather than raw credentials.
 * In particular, `proxyAuthHelper` owns the proxy route and authentication and
 * must return the complete proxy dispatcher (it receives TLS material so it
 * can compose the transport when both are required). The origin request never
 * receives a `Proxy-Authorization` header.
 */
export class ResilientGatewayClient {
  constructor(options = {}) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    if (typeof options.fetch !== "function") {
      throw gatewayError(
        "CC_GATEWAY_OPTIONS_INVALID",
        "gateway fetch is required",
      );
    }
    this.fetch = options.fetch;
    this.tlsProvider = options.tlsProvider || null;
    this.proxyAuthHelper = options.proxyAuthHelper || null;
    if (this.tlsProvider !== null && typeof this.tlsProvider !== "function") {
      throw gatewayError(
        "CC_GATEWAY_OPTIONS_INVALID",
        "gateway TLS provider is invalid",
      );
    }
    if (
      this.proxyAuthHelper !== null &&
      typeof this.proxyAuthHelper !== "function"
    ) {
      throw gatewayError(
        "CC_GATEWAY_OPTIONS_INVALID",
        "gateway proxy helper is invalid",
      );
    }
    this.deps = {
      setTimeout: options.setTimeout || setTimeout,
      clearTimeout: options.clearTimeout || clearTimeout,
    };
  }

  async _request(path, options = {}) {
    const relativePath = safeRelativePath(path);
    const prefix = this.baseUrl.pathname.replace(/\/+$/u, "");
    const endpoint = new URL(`${prefix}${relativePath}`, this.baseUrl.origin);
    if (
      endpoint.origin !== this.baseUrl.origin ||
      (prefix &&
        endpoint.pathname !== prefix &&
        !endpoint.pathname.startsWith(`${prefix}/`))
    ) {
      throw gatewayError(
        "CC_GATEWAY_PATH_INVALID",
        "gateway request path is invalid",
      );
    }
    const headers = safeHeaders(options.headers);
    headers.Accept = "text/event-stream";
    if (options.lastEventId)
      headers["Last-Event-ID"] = safeEventId(options.lastEventId);

    let tls = null;
    let tlsDispatcher = null;
    try {
      tls = this.tlsProvider
        ? await this.tlsProvider({ origin: endpoint.origin })
        : null;
      if (tls != null) tlsDispatcher = transportDispatcher(tls);
    } catch {
      throw gatewayError(
        "CC_GATEWAY_TLS_UNAVAILABLE",
        "gateway TLS material is unavailable",
      );
    }

    let proxyDispatcher = null;
    if (this.proxyAuthHelper) {
      try {
        const transport = await this.proxyAuthHelper({
          origin: endpoint.origin,
          tls,
        });
        proxyDispatcher = transportDispatcher(transport);
      } catch {
        throw gatewayError(
          "CC_GATEWAY_PROXY_AUTH_UNAVAILABLE",
          "gateway proxy authentication is unavailable",
        );
      }
    }

    try {
      return await this.fetch(endpoint.href, {
        method: "GET",
        headers,
        signal: options.signal,
        ...(proxyDispatcher || tlsDispatcher
          ? { dispatcher: proxyDispatcher || tlsDispatcher }
          : {}),
      });
    } catch (error) {
      throw normalizeGatewayError(error);
    }
  }

  async stream(path, options = {}) {
    const idleTimeoutMs = positiveInteger(
      options.idleTimeoutMs,
      30_000,
      MIN_IDLE_TIMEOUT_MS,
      MAX_IDLE_TIMEOUT_MS,
    );
    const maxReconnects = positiveInteger(
      options.maxReconnects,
      2,
      0,
      MAX_RECONNECT_ATTEMPTS,
    );
    let lastEventId = options.lastEventId
      ? safeEventId(options.lastEventId)
      : "";
    let reconnects = 0;
    for (;;) {
      try {
        const response = await this._request(path, {
          headers: options.headers,
          signal: options.signal,
          lastEventId,
        });
        const result = await consumeSse(
          response,
          {
            idleTimeoutMs,
            lastEventId,
            onEvent: options.onEvent,
            onKeepalive: options.onKeepalive,
          },
          this.deps,
        );
        return Object.freeze({ ...result, reconnects });
      } catch (error) {
        const normalized = error?.code ? error : normalizeGatewayError(error);
        if (normalized.lastEventId)
          lastEventId = safeEventId(normalized.lastEventId);
        if (
          !isRetryableGatewayError(normalized) ||
          reconnects >= maxReconnects
        ) {
          throw normalized;
        }
        reconnects += 1;
      }
    }
  }
}
