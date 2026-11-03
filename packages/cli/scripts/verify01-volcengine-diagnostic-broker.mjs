/** Diagnostic transport only. Deliberately changes thinking and output policy;
 * never supplies formal-budget activation or frozen sample admission. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash, randomBytes } from "node:crypto";
import { requireUnscopedModelTransport } from "../src/lib/formal-budget-provider-scope.js";

export const BROKER = Object.freeze({
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  model: "deepseek-v4-flash-ga-260731",
  maximumRequestsPerTask: 14,
  maximumRequestBytes: 256 * 1024,
  maximumResponseBytes: 1024 * 1024,
  maximumAnswerTokens: 8192,
  timeoutMs: 45000,
  connectionAttemptTimeoutMs: 2000,
  thinking: "disabled",
  formalSample: false,
});
const fileTools = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);
const check = (ok, code) => {
  if (!ok) throw new Error(code);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Accounting evidence must reject decoded duplicate members and nonfinite
// numeric literals instead of accepting JSON.parse's last-member-wins result.
export function parseDiagnosticJson(text) {
  let at = 0;
  const whitespace = () => {
    while (at < text.length && /[\x20\t\r\n]/u.test(text[at])) at++;
  };
  function string() {
    check(text[at] === '"', "DIAGNOSTIC_JSON_STRING_EXPECTED");
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') return JSON.parse(text.slice(start, at));
      if (char === "\\") at++;
    }
    throw new Error("DIAGNOSTIC_JSON_UNTERMINATED_STRING");
  }
  function value(depth) {
    check(depth <= 64, "DIAGNOSTIC_JSON_NESTING_LIMIT");
    whitespace();
    if (text[at] === '"') {
      string();
      return;
    }
    if (text[at] === "{") {
      at++;
      whitespace();
      const keys = new Set();
      if (text[at] === "}") {
        at++;
        return;
      }
      for (;;) {
        whitespace();
        const key = string();
        check(!keys.has(key), "DIAGNOSTIC_JSON_DUPLICATE_MEMBER");
        keys.add(key);
        whitespace();
        check(text[at++] === ":", "DIAGNOSTIC_JSON_MEMBER_SEPARATOR");
        value(depth + 1);
        whitespace();
        const separator = text[at++];
        if (separator === "}") return;
        check(separator === ",", "DIAGNOSTIC_JSON_OBJECT_SEPARATOR");
      }
    }
    if (text[at] === "[") {
      at++;
      whitespace();
      if (text[at] === "]") {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        whitespace();
        const separator = text[at++];
        if (separator === "]") return;
        check(separator === ",", "DIAGNOSTIC_JSON_ARRAY_SEPARATOR");
      }
    }
    for (const literal of ["true", "false", "null"])
      if (text.startsWith(literal, at)) {
        at += literal.length;
        return;
      }
    const number = text
      .slice(at)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    check(
      number && Number.isFinite(Number(number)),
      "DIAGNOSTIC_JSON_INVALID_NUMBER",
    );
    at += number.length;
  }
  value(0);
  whitespace();
  check(at === text.length, "DIAGNOSTIC_JSON_TRAILING_INPUT");
  return JSON.parse(text);
}

export function diagnosticBody(
  input,
  {
    allowTextOnlyRequests = false,
    maximumAnswerTokens = BROKER.maximumAnswerTokens,
    parallelToolCalls = false,
    preserveExplicitOutputLimits = false,
    internalSummaryTokenMultiplier = 1,
    maximumInternalSummaryTokens,
  } = {},
) {
  check(
    [8192, 16384, 393216].includes(maximumAnswerTokens),
    "DIAGNOSTIC_OUTPUT_POLICY_INVALID",
  );
  check(
    parallelToolCalls === false || parallelToolCalls === null,
    "DIAGNOSTIC_PARALLEL_POLICY_INVALID",
  );
  check(
    typeof preserveExplicitOutputLimits === "boolean",
    "DIAGNOSTIC_EXPLICIT_OUTPUT_POLICY_INVALID",
  );
  check(
    internalSummaryTokenMultiplier === 1 ||
      (internalSummaryTokenMultiplier === 2 &&
        maximumInternalSummaryTokens === 4096 &&
        preserveExplicitOutputLimits),
    "DIAGNOSTIC_INTERNAL_SUMMARY_BUDGET_INVALID",
  );
  if (preserveExplicitOutputLimits && input?.max_tokens !== undefined) {
    check(
      Number.isSafeInteger(input.max_tokens) && input.max_tokens > 0,
      "DIAGNOSTIC_EXPLICIT_OUTPUT_LIMIT_INVALID",
    );
  }
  check(input?.model === BROKER.model, "DIAGNOSTIC_MODEL_MISMATCH");
  check(
    input.stream === undefined || typeof input.stream === "boolean",
    "DIAGNOSTIC_INVALID_STREAM_MODE",
  );
  const streaming = input.stream === true;
  check(
    Array.isArray(input.messages) && input.messages.length > 0,
    "DIAGNOSTIC_MESSAGES_REQUIRED",
  );
  check(
    (allowTextOnlyRequests && input.tools === undefined) ||
      (Array.isArray(input.tools) &&
        (allowTextOnlyRequests || input.tools.length > 0) &&
        input.tools.every(
          (t) => t?.type === "function" && fileTools.has(t.function?.name),
        )),
    "DIAGNOSTIC_FILE_TOOLS_REQUIRED",
  );
  check(
    Object.keys(input).every((k) =>
      [
        "model",
        "messages",
        "tools",
        "stream",
        "stream_options",
        "max_tokens",
      ].includes(k),
    ),
    "DIAGNOSTIC_UNEXPECTED_FIELD",
  );
  const body = {
    model: BROKER.model,
    messages: input.messages,
    ...(input.tools?.length ? { tools: input.tools } : {}),
    stream: streaming,
    ...(streaming ? { stream_options: { include_usage: true } } : {}),
    max_tokens:
      preserveExplicitOutputLimits && input.max_tokens !== undefined
        ? Math.min(input.max_tokens, maximumAnswerTokens)
        : maximumAnswerTokens,
    thinking: { type: "disabled" },
    service_tier: "default",
    ...(parallelToolCalls === null ? {} : { parallel_tool_calls: false }),
  };
  // The2x reference widens the permitted summary ceiling, not the caller's
  // reservation. Native compaction may have reserved only2048; never turn that
  // request into4096 behind its accounting boundary.
  if (
    internalSummaryTokenMultiplier === 2 &&
    !streaming &&
    (input.tools?.length ?? 0) === 0 &&
    Number.isSafeInteger(input.max_tokens) &&
    input.max_tokens > 0
  ) {
    body.max_tokens = Math.min(
      input.max_tokens,
      maximumInternalSummaryTokens,
      maximumAnswerTokens,
    );
  }
  check(
    Buffer.byteLength(JSON.stringify(body)) <= BROKER.maximumRequestBytes,
    "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
  );
  return body;
}

export function diagnosticJsonUsage(raw, options = {}) {
  // Validate the actual JSON envelope first. The shared accounting validator
  // below receives its existing facts, never manufactured identity or usage.
  const response = parseDiagnosticJson(raw);
  check(
    response && !Object.hasOwn(response, "error"),
    "DIAGNOSTIC_PROVIDER_ERROR",
  );
  check(
    typeof response.id === "string" && response.id.length > 0,
    "DIAGNOSTIC_RESPONSE_ID_UNKNOWN",
  );
  check(
    Array.isArray(response.choices) &&
      response.choices.length === 1 &&
      response.choices[0].index === 0,
    "DIAGNOSTIC_EXTRA_CHOICE",
  );
  const choice = response.choices[0];
  check(
    choice.message &&
      !Array.isArray(choice.message) &&
      choice.message.role === "assistant",
    "DIAGNOSTIC_MESSAGE_UNKNOWN",
  );
  const message = choice.message;
  check(
    message.content === undefined ||
      message.content === null ||
      typeof message.content === "string",
    "DIAGNOSTIC_CONTENT_INVALID",
  );
  check(
    message.tool_calls === undefined || Array.isArray(message.tool_calls),
    "DIAGNOSTIC_TOOL_CALLS_INVALID",
  );
  if (Array.isArray(message.tool_calls)) {
    check(
      message.tool_calls.every(
        (call) =>
          typeof call?.id === "string" &&
          call.id.length > 0 &&
          call.type === "function" &&
          fileTools.has(call.function?.name) &&
          typeof call.function.arguments === "string",
      ),
      "DIAGNOSTIC_TOOL_CALLS_INVALID",
    );
  }
  if (choice.finish_reason === "tool_calls")
    check(message.tool_calls?.length > 0, "DIAGNOSTIC_TOOL_CALLS_MISSING");
  return diagnosticUsage(
    `data: ${JSON.stringify({ ...response, choices: [{ index: choice.index, delta: choice.message, finish_reason: choice.finish_reason }] })}\n\ndata: [DONE]\n\n`,
    options,
  );
}

export function diagnosticUsage(
  raw,
  { maximumAnswerTokens = BROKER.maximumAnswerTokens } = {},
) {
  check(
    [8192, 16384, 393216].includes(maximumAnswerTokens),
    "DIAGNOSTIC_OUTPUT_POLICY_INVALID",
  );
  let done = false,
    usage = null,
    finish = null;
  const models = new Set(),
    tiers = new Set();
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    check(!done, "DIAGNOSTIC_EVENT_AFTER_DONE");
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    const event = parseDiagnosticJson(data);
    check(!Object.hasOwn(event, "error"), "DIAGNOSTIC_PROVIDER_ERROR");
    if (event.model) models.add(event.model);
    if (event.service_tier) tiers.add(event.service_tier);
    if (event.usage) {
      check(
        usage === null || JSON.stringify(usage) === JSON.stringify(event.usage),
        "DIAGNOSTIC_CONFLICTING_USAGE",
      );
      usage = event.usage;
    }
    for (const choice of event.choices || []) {
      check(choice.index === 0, "DIAGNOSTIC_EXTRA_CHOICE");
      if (choice.finish_reason) {
        check(
          finish === null || finish === choice.finish_reason,
          "DIAGNOSTIC_CONFLICTING_FINISH",
        );
        finish = choice.finish_reason;
      }
      check(
        !choice.delta?.reasoning_content,
        "DIAGNOSTIC_UNEXPECTED_REASONING",
      );
    }
  }
  check(
    done && ["stop", "tool_calls", "length"].includes(finish),
    "DIAGNOSTIC_INCOMPLETE_STREAM",
  );
  check(
    models.size === 1 && models.has(BROKER.model),
    "DIAGNOSTIC_RESPONSE_MODEL_UNKNOWN",
  );
  check(
    tiers.size === 1 && tiers.has("default"),
    "DIAGNOSTIC_RESPONSE_TIER_UNKNOWN",
  );
  check(
    usage &&
      [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ),
    "DIAGNOSTIC_USAGE_UNKNOWN",
  );
  check(
    usage.total_tokens === usage.prompt_tokens + usage.completion_tokens,
    "DIAGNOSTIC_USAGE_INCONSISTENT",
  );
  check(
    usage.completion_tokens <= maximumAnswerTokens,
    "DIAGNOSTIC_OUTPUT_LIMIT_EXCEEDED",
  );
  const cached = usage.prompt_tokens_details?.cached_tokens;
  check(
    Number.isSafeInteger(cached) &&
      cached >= 0 &&
      cached <= usage.prompt_tokens,
    "DIAGNOSTIC_CACHE_USAGE_UNKNOWN",
  );
  check(
    usage.completion_tokens_details?.reasoning_tokens === 0,
    "DIAGNOSTIC_REASONING_USAGE_UNKNOWN",
  );
  return {
    usage,
    finish,
    tokenOnlyEstimateCny:
      ((usage.prompt_tokens - cached) * 3 +
        cached * 0.1 +
        usage.completion_tokens * 9) /
      1e6,
  };
}

function responseByteLimit(options) {
  const limit = options.maximumResponseBytes ?? BROKER.maximumResponseBytes;
  check(
    Number.isSafeInteger(limit) && limit >= 1024 && limit <= 16 * 1024 * 1024,
    "DIAGNOSTIC_RESPONSE_LIMIT_POLICY_INVALID",
  );
  return limit;
}

export function requestArk(body, key, options = {}) {
  return requestFixedDiagnosticEndpoint(body, key, options, BROKER);
}

/** Fixed operator-owned transport policy; never derived from a child URL. */
export function requestFixedDiagnosticEndpoint(body, key, options, policy) {
  requireUnscopedModelTransport();
  check(
    new URL(policy.endpoint).protocol === "https:",
    "DIAGNOSTIC_HTTPS_REQUIRED",
  );
  const requestFactory = options.requestFactory || https.request;
  const timeoutMs = options.timeoutMs ?? policy.timeoutMs;
  const maximumResponseBytes = responseByteLimit({
    ...options,
    maximumResponseBytes:
      options.maximumResponseBytes ?? policy.maximumResponseBytes,
  });
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body),
      chunks = [];
    let bytes = 0,
      status = null,
      finished = false,
      timer = null,
      req = null;
    const started = Date.now();
    const transport = {
      socketAssignedMs: null,
      dnsLookupMs: null,
      tcpConnectedMs: null,
      tlsConnectedMs: null,
      dispatchStartedMs: null,
      requestFinishedMs: null,
      responseStartedMs: null,
      dispatchStarted: false,
      failureCategory: null,
      connectionAttempts: [],
      nestedErrorCodes: [],
      errorCode: null,
      errorSyscall: null,
    };
    const mark = (name) => {
      transport[name] = Date.now() - started;
    };
    const safeDiagnostic = (value) => {
      const normalized = typeof value === "string" ? value.toUpperCase() : "";
      return /^[A-Z0-9_]{1,48}$/u.test(normalized) ? normalized : null;
    };
    function finish(error, cause) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      transport.failureCategory = error || null;
      transport.errorCode = safeDiagnostic(cause?.code);
      transport.errorSyscall = safeDiagnostic(cause?.syscall);
      transport.nestedErrorCodes = Array.isArray(cause?.errors)
        ? cause.errors.slice(0, 8).map((item) => safeDiagnostic(item?.code))
        : [];
      const settledError =
        error && !transport.dispatchStarted && status === null
          ? "DIAGNOSTIC_REQUEST_NOT_DISPATCHED"
          : error;
      const result = {
        status,
        raw: Buffer.concat(chunks),
        errorCode: settledError || null,
        transport: { ...transport },
      };
      if (settledError)
        reject(Object.assign(new Error(settledError), { captured: result }));
      else resolve(result);
    }
    try {
      req = requestFactory(policy.endpoint, {
        method: "POST",
        agent: false,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: policy.connectionAttemptTimeoutMs,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      });
    } catch (error) {
      finish("DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN", error);
      return;
    }
    timer = setTimeout(() => {
      finish("DIAGNOSTIC_TIMEOUT_USAGE_UNKNOWN");
      req.destroy();
    }, timeoutMs);
    // No HTTP bytes are submitted to ClientRequest until TLS is ready. A
    // failure before this gate is provably local; after it, usage is unknown.
    req.on("socket", (socket) => {
      mark("socketAssignedMs");
      const attempt = (event, family, error) => {
        if (transport.connectionAttempts.length >= 16) return;
        transport.connectionAttempts.push({
          event,
          family: [4, 6].includes(family) ? family : null,
          elapsedMs: Date.now() - started,
          errorCode: safeDiagnostic(error?.code),
        });
      };
      socket.on("connectionAttempt", (_ip, _port, family) =>
        attempt("start", family),
      );
      socket.on("connectionAttemptFailed", (_ip, _port, family, error) =>
        attempt("failed", family, error),
      );
      socket.on("connectionAttemptTimeout", (_ip, _port, family) =>
        attempt("timeout", family),
      );
      socket.once("lookup", () => mark("dnsLookupMs"));
      socket.once("connect", () => mark("tcpConnectedMs"));
      socket.once("secureConnect", () => {
        mark("tlsConnectedMs");
        if (finished) return;
        transport.dispatchStarted = true;
        mark("dispatchStartedMs");
        try {
          req.end(payload);
        } catch (error) {
          finish("DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN", error);
          req.destroy();
        }
      });
    });
    req.on("finish", () => mark("requestFinishedMs"));
    req.on("response", (res) => {
      mark("responseStartedMs");
      status = res.statusCode;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maximumResponseBytes) {
          // IncomingMessage.destroy emits aborted synchronously. Settle the
          // actual limit failure first so teardown cannot replace its cause.
          finish("DIAGNOSTIC_RESPONSE_LIMIT_USAGE_UNKNOWN");
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish());
      res.on("error", () => finish("DIAGNOSTIC_RESPONSE_ERROR_USAGE_UNKNOWN"));
      res.on("aborted", () =>
        finish("DIAGNOSTIC_RESPONSE_ABORTED_USAGE_UNKNOWN"),
      );
    });
    req.on("error", (error) =>
      finish("DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN", error),
    );
  });
}

export function volcengineBudgetRetryPolicy(budgets) {
  if (!budgets || budgets.modelTurns === 20) return BROKER;
  check(
    budgets.modelTurns === 40 &&
      budgets.physicalRequests === 48 &&
      [8192, 16384, 393216].includes(budgets.outputTokens) &&
      [undefined, 10000].includes(budgets.connectionAttemptTimeoutMs) &&
      [undefined, null].includes(budgets.parallelToolCalls),
    "DIAGNOSTIC_EXPANDED_BUDGET_INVALID",
  );
  check(
    [undefined, true].includes(budgets.preserveExplicitOutputLimits),
    "DIAGNOSTIC_EXPLICIT_OUTPUT_POLICY_INVALID",
  );
  check(
    [undefined, true].includes(budgets.allowInternalTextLength) &&
      (budgets.allowInternalTextLength !== true ||
        budgets.preserveExplicitOutputLimits === true),
    "DIAGNOSTIC_INTERNAL_TEXT_LENGTH_POLICY_INVALID",
  );
  const tokenFields = [
    "solTokenBudgetMultiple",
    "maximumTaskTokens",
    "maximumTaskOutputTokens",
    "internalSummaryTokenMultiplier",
    "maximumInternalSummaryTokens",
  ];
  const boundedTokens = tokenFields.some((k) => budgets[k] !== undefined);
  if (boundedTokens)
    check(
      budgets.solTokenBudgetMultiple === 2 &&
        budgets.outputTokens === 16384 &&
        budgets.maximumTaskTokens === 1966080 &&
        budgets.maximumTaskOutputTokens === 393216 &&
        budgets.internalSummaryTokenMultiplier === 2 &&
        budgets.maximumInternalSummaryTokens === 4096 &&
        budgets.preserveExplicitOutputLimits === true,
      "DIAGNOSTIC_TASK_TOKEN_POLICY_INVALID",
    );
  return Object.freeze({
    ...BROKER,
    maximumRequestsPerTask: 48,
    maximumAnswerTokens: budgets.outputTokens,
    timeoutMs: 180000,
    maximumResponseBytes: 16 * 1024 * 1024,
    ...(budgets.connectionAttemptTimeoutMs === 10000
      ? { connectionAttemptTimeoutMs: 10000 }
      : {}),
    ...(budgets.parallelToolCalls === null ? { parallelToolCalls: null } : {}),
    ...(budgets.preserveExplicitOutputLimits === true
      ? { preserveExplicitOutputLimits: true }
      : {}),
    ...(budgets.allowInternalTextLength === true
      ? { allowInternalTextLength: true }
      : {}),
    ...(boundedTokens
      ? Object.fromEntries(tokenFields.map((k) => [k, budgets[k]]))
      : {}),
  });
}

export async function createVolcengineDiagnosticBroker(options) {
  const policy = volcengineBudgetRetryPolicy(options.executionBudgets);
  const usageOptions = {
    maximumAnswerTokens: policy.maximumAnswerTokens,
    parallelToolCalls: policy.parallelToolCalls === null ? null : false,
    preserveExplicitOutputLimits: policy.preserveExplicitOutputLimits === true,
    ...(policy.internalSummaryTokenMultiplier === 2
      ? {
          internalSummaryTokenMultiplier: 2,
          maximumInternalSummaryTokens: policy.maximumInternalSummaryTokens,
        }
      : {}),
  };
  const readUsage = (reader, raw, effective) => {
    const result = reader(raw, usageOptions);
    if (policy.preserveExplicitOutputLimits) {
      check(
        result.usage.completion_tokens <= effective.max_tokens,
        "DIAGNOSTIC_EXPLICIT_OUTPUT_LIMIT_EXCEEDED",
      );
    }
    return result;
  };
  return createBoundedDiagnosticBroker(options, {
    policy,
    maximumRequestAllowance: policy === BROKER ? 32 : 48,
    route: "/api/v3/chat/completions",
    basePath: "/api/v3",
    request:
      policy === BROKER
        ? requestArk
        : (body, key, options) =>
            requestFixedDiagnosticEndpoint(body, key, options, policy),
    body: (input, options) =>
      diagnosticBody(input, { ...options, ...usageOptions }),
    sseUsage: (raw, effective) => readUsage(diagnosticUsage, raw, effective),
    jsonUsage: (raw, effective) =>
      readUsage(diagnosticJsonUsage, raw, effective),
    acceptInternalTextLength: ({ original, effective, captured, row }) => {
      if (
        !policy.allowInternalTextLength ||
        !policy.preserveExplicitOutputLimits ||
        effective.stream ||
        !Number.isSafeInteger(original.max_tokens) ||
        original.max_tokens <= 0 ||
        (original.tools?.length ?? 0) !== 0 ||
        effective.tools !== undefined ||
        row.usage === null
      )
        return false;
      const response = parseDiagnosticJson(
        new TextDecoder("utf-8", { fatal: true }).decode(captured.raw),
      );
      const message = response.choices[0].message;
      return (
        typeof message.content === "string" &&
        (message.tool_calls?.length ?? 0) === 0
      );
    },
    estimateField: "tokenOnlyEstimateCny",
    billedField: "actualBilledCostCny",
    defaultThinkingPreserved: false,
  });
}

/** Shared durable capture and request limits for diagnostic-only transports. */
export async function createBoundedDiagnosticBroker(options, profile) {
  requireUnscopedModelTransport();
  const { outputDir, key, requestImpl = profile.request } = options;
  const { policy } = profile;
  const allowedTaskIds = options.allowedTaskIds || ["verify-04", "verify-22"];
  const maximumRequestsPerTask =
    options.maximumRequestsPerTask ?? policy.maximumRequestsPerTask;
  const requestTimeoutMs = options.requestTimeoutMs ?? policy.timeoutMs;
  const maximumResponseBytes = responseByteLimit({
    ...options,
    maximumResponseBytes:
      options.maximumResponseBytes ?? policy.maximumResponseBytes,
  });
  const allowTextOnlyRequests = options.allowTextOnlyRequests === true;
  check(
    Array.isArray(allowedTaskIds) &&
      allowedTaskIds.length > 0 &&
      allowedTaskIds.length <= 45 &&
      new Set(allowedTaskIds).size === allowedTaskIds.length &&
      allowedTaskIds.every((id) =>
        /^(?:verify-(?:0[1-9]|[12][0-9]|3[0-6])|first-run-(?:win32|linux|darwin)-(?:cli|vscode|jetbrains))$/u.test(
          id,
        ),
      ) &&
      Number.isSafeInteger(maximumRequestsPerTask) &&
      maximumRequestsPerTask > 0 &&
      (maximumRequestsPerTask <= 32 ||
        (profile.maximumRequestAllowance === 48 &&
          maximumRequestsPerTask <= 48)),
    "DIAGNOSTIC_TASK_POLICY_INVALID",
  );
  check(
    Number.isSafeInteger(requestTimeoutMs) &&
      requestTimeoutMs >= 1000 &&
      requestTimeoutMs <= 180000,
    "DIAGNOSTIC_TIMEOUT_POLICY_INVALID",
  );
  check(typeof key === "string" && key.length > 0, "DIAGNOSTIC_KEY_REQUIRED");
  // A restarted broker cannot reuse this request allowance.
  fs.mkdirSync(outputDir, { mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const redact = (value) => {
    let text = String(value);
    for (const [secret, replacement] of [
      [key, "[REDACTED]"],
      [token, "[BROKER_CAPABILITY]"],
    ])
      for (const encoded of new Set([
        secret,
        JSON.stringify(secret).slice(1, -1),
      ]))
        text = text.replaceAll(encoded, replacement);
    return text;
  };
  function save(file, value) {
    const bytes =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const fd = fs.openSync(path.join(outputDir, file), "wx", 0o600);
    try {
      fs.writeFileSync(fd, redact(bytes));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return {
      storedSha256: hash(Buffer.from(redact(bytes))),
      storedBytes: Buffer.byteLength(redact(bytes)),
    };
  }
  const tasks = [],
    receipts = [];
  let active = null,
    pending = false,
    poisoned = null;
  const tokenBudgetEnabled = policy.maximumTaskTokens !== undefined;
  function taskTokenStatus(taskId) {
    const rows = receipts.filter((r) => r.taskId === taskId);
    const known = rows.filter((r) => r.usage !== null);
    const unsettled = rows.filter(
      (r) =>
        r.usage === null && r.errorCode !== "DIAGNOSTIC_REQUEST_NOT_DISPATCHED",
    );
    const knownTotalTokens = known.reduce(
      (n, r) => n + r.usage.total_tokens,
      0,
    );
    const knownOutputTokens = known.reduce(
      (n, r) => n + r.usage.completion_tokens,
      0,
    );
    const unsettledReservedTokens = unsettled.reduce(
      (n, r) => n + (r.tokenReservation?.reservedTotalTokens ?? 0),
      0,
    );
    const unsettledReservedOutputTokens = unsettled.reduce(
      (n, r) => n + (r.tokenReservation?.maximumOutputTokens ?? 0),
      0,
    );
    return {
      maximumTaskTokens: policy.maximumTaskTokens,
      maximumTaskOutputTokens: policy.maximumTaskOutputTokens,
      knownTotalTokens,
      knownOutputTokens,
      unsettledRequests: unsettled.length,
      unsettledReservedTokens,
      unsettledReservedOutputTokens,
      remainingTokens:
        policy.maximumTaskTokens - knownTotalTokens - unsettledReservedTokens,
      remainingOutputTokens:
        policy.maximumTaskOutputTokens -
        knownOutputTokens -
        unsettledReservedOutputTokens,
    };
  }
  function reserveTaskTokens(effective) {
    const status = taskTokenStatus(active.taskId);
    // Conservative byte bound plus message/tool framing, not an unverified
    // tokenizer estimate. A provider usage above this bound fails closed.
    const inputTokenUpperBound =
      Buffer.byteLength(JSON.stringify(effective)) +
      4096 +
      16 * effective.messages.length +
      128 * (effective.tools?.length ?? 0);
    const maximumOutputTokens = Math.min(
      effective.max_tokens,
      status.remainingOutputTokens,
      status.remainingTokens - inputTokenUpperBound,
    );
    check(
      Number.isSafeInteger(maximumOutputTokens) && maximumOutputTokens > 0,
      "DIAGNOSTIC_TASK_TOKEN_BUDGET_EXHAUSTED",
    );
    effective.max_tokens = maximumOutputTokens;
    return {
      inputTokenUpperBound,
      maximumOutputTokens,
      reservedTotalTokens: inputTokenUpperBound + maximumOutputTokens,
    };
  }
  const server = http.createServer(async (req, res) => {
    const rejectLocal = (code) => {
      if (!res.destroyed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: code } }));
      }
    };
    if (
      req.method !== "POST" ||
      req.url !== profile.route ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      rejectLocal("DIAGNOSTIC_BROKER_ACCESS_DENIED");
      return;
    }
    if (
      pending ||
      poisoned ||
      active?.errorCode ||
      !active ||
      active.requests >= maximumRequestsPerTask
    ) {
      rejectLocal(
        poisoned ||
          active?.errorCode ||
          "DIAGNOSTIC_REQUEST_ALLOWANCE_EXHAUSTED",
      );
      return;
    }
    pending = true;
    let row = null,
      captured = null;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        check(
          bytes <= policy.maximumRequestBytes,
          "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
        );
        chunks.push(chunk);
      }
      const original = parseDiagnosticJson(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      const effective = profile.body(original, { allowTextOnlyRequests });
      const tokenReservation = tokenBudgetEnabled
        ? reserveTaskTokens(effective)
        : null;
      const id = receipts.length + 1;
      save(`request-${id}.original.json`, original);
      save(`request-${id}.effective.json`, effective);
      active.requests += 1;
      row = {
        id,
        taskId: active.taskId,
        startedAt: new Date().toISOString(),
        usage: null,
        [profile.estimateField]: null,
        [profile.billedField]: null,
        errorCode: null,
        responseMode: effective.stream ? "sse" : "json",
        ...(tokenReservation ? { tokenReservation } : {}),
      };
      // Persist the physical dispatch slot before network egress.
      save(`request-${id}.dispatch.json`, row);
      receipts.push(row);
      captured = await requestImpl(effective, key, {
        timeoutMs: requestTimeoutMs,
        maximumResponseBytes,
      });
      check(captured.status === 200, "DIAGNOSTIC_NON_200_NO_RETRY");
      Object.assign(
        row,
        (effective.stream ? profile.sseUsage : profile.jsonUsage)(
          new TextDecoder("utf-8", { fatal: true }).decode(captured.raw),
          effective,
        ),
      );
      if (tokenBudgetEnabled) {
        check(
          row.usage.prompt_tokens <= row.tokenReservation.inputTokenUpperBound,
          "DIAGNOSTIC_INPUT_TOKEN_BOUND_EXCEEDED",
        );
        check(
          row.usage.completion_tokens <=
            row.tokenReservation.maximumOutputTokens,
          "DIAGNOSTIC_TASK_OUTPUT_RESERVATION_EXCEEDED",
        );
        const settled = taskTokenStatus(active.taskId);
        check(
          settled.knownTotalTokens <= policy.maximumTaskTokens &&
            settled.knownOutputTokens <= policy.maximumTaskOutputTokens,
          "DIAGNOSTIC_TASK_TOKEN_BUDGET_EXCEEDED",
        );
      }
      const internalBoundary =
        row.finish === "length" &&
        profile.acceptInternalTextLength?.({
          original,
          effective,
          captured,
          row,
        }) === true;
      if (internalBoundary) row.internalTextOutputBoundaryAccepted = true;
      check(
        row.finish !== "length" || internalBoundary,
        "DIAGNOSTIC_OUTPUT_TRUNCATED",
      );
    } catch (error) {
      // An oversized request is rejected before dispatch. It invalidates this
      // task, but no provider usage or response is left unknown for the next.
      captured ||= error.captured || null;
      if (
        [
          "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
          "DIAGNOSTIC_TASK_TOKEN_BUDGET_EXHAUSTED",
        ].includes(error.message) &&
        !row
      ) {
        active.errorCode = error.message;
      } else if (
        error.message === "DIAGNOSTIC_REQUEST_NOT_DISPATCHED" &&
        row &&
        captured?.transport?.dispatchStarted === false &&
        captured.status === null &&
        captured.raw.length === 0
      ) {
        active.errorCode = error.message;
      } else if (
        error.message === "DIAGNOSTIC_OUTPUT_TRUNCATED" &&
        captured?.status === 200 &&
        row?.finish === "length" &&
        row.usage !== null
      ) {
        // Usage is fully validated, but truncated tool arguments are unusable.
        // Persist the evidence and reject this task without forwarding output.
        active.errorCode = error.message;
      } else {
        poisoned =
          error.message === "DIAGNOSTIC_REQUEST_NOT_DISPATCHED"
            ? "DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN"
            : error.message.startsWith("DIAGNOSTIC_")
              ? error.message
              : "DIAGNOSTIC_INVALID_RESPONSE_USAGE_UNKNOWN";
      }
      if (row) row.errorCode = poisoned || active.errorCode;
    } finally {
      try {
        if (row) {
          row.finishedAt = new Date().toISOString();
          if (captured?.transport) row.transport = captured.transport;
          if (captured) {
            const stored = save(
              `response-${row.id}.${row.responseMode}`,
              captured.raw.toString("utf8"),
            );
            row.response = {
              ...stored,
              status: captured.status,
              originalSha256: hash(captured.raw),
              originalBytes: captured.raw.length,
              sensitiveValueRedacted:
                captured.raw.includes(Buffer.from(key)) ||
                captured.raw.includes(Buffer.from(token)),
            };
          }
          save(`request-${row.id}.receipt.json`, row);
        }
      } catch {
        poisoned = "DIAGNOSTIC_EVIDENCE_FAILURE";
      }
      pending = false;
      // Never expose a successful terminal to the product until both raw
      // response and complete receipt have been durably written.
      if (poisoned || active?.errorCode)
        rejectLocal(poisoned || active.errorCode);
      else if (!res.destroyed) {
        res.writeHead(200, {
          "Content-Type":
            row.responseMode === "sse"
              ? "text/event-stream"
              : "application/json",
        });
        res.end(redact(captured.raw.toString("utf8")));
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  save("policy.json", {
    ...policy,
    allowedTaskIds,
    maximumRequestsPerTask,
    timeoutMs: requestTimeoutMs,
    maximumResponseBytes,
    allowTextOnlyRequests,
    retries: 0,
    redirects: false,
    fallback: false,
    credentialsInModelChild: false,
    [profile.billedField]: null,
    fxRate: null,
    defaultThinkingPreserved: profile.defaultThinkingPreserved,
    providerHardQuotaVerified: false,
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}${profile.basePath}`,
    childKey: token,
    beginTask(taskId) {
      requireUnscopedModelTransport();
      check(
        !pending &&
          !poisoned &&
          allowedTaskIds.includes(taskId) &&
          !tasks.some((t) => t.taskId === taskId),
        "DIAGNOSTIC_TASK_ALLOWANCE_INVALID",
      );
      active = { taskId, requests: 0, errorCode: null };
      tasks.push(active);
    },
    taskStatus(taskId) {
      const rows = receipts.filter((r) => r.taskId === taskId);
      const task = tasks.find((item) => item.taskId === taskId);
      return {
        physicalRequestsStarted: rows.length,
        usageCompleteRequests: rows.filter((r) => r.usage !== null).length,
        passed:
          !pending &&
          !poisoned &&
          !task?.errorCode &&
          rows.length > 0 &&
          rows.every((r) => r.usage !== null && r.errorCode === null),
        poisoned,
        errorCode: task?.errorCode || null,
        ...(tokenBudgetEnabled ? { tokenBudget: taskTokenStatus(taskId) } : {}),
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      const known = receipts.filter((r) => r.usage !== null);
      const result = {
        formalSample: false,
        physicalRequestsStarted: receipts.length,
        usageCompleteRequests: known.length,
        tasks,
        poisoned,
        [profile.billedField]: null,
        [profile.estimateField]:
          known.length === receipts.length && receipts.length > 0
            ? known.reduce((s, r) => s + r[profile.estimateField], 0)
            : null,
        [profile.estimateField === "tokenOnlyEstimateCny"
          ? "knownTokenOnlyEstimateCny"
          : "knownTokenOnlyEstimateUsd"]: known.reduce(
          (s, r) => s + r[profile.estimateField],
          0,
        ),
        fxRate: null,
      };
      save("summary.json", result);
      return result;
    },
  };
}
