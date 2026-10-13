import {
  budgetError,
  canonical,
  requireBudget,
} from "./formal-budget-contract.js";

export const FORMAL_BUDGET_RUNTIME_READINESS = Object.freeze({
  paidReady: false,
  reason:
    "Agent, Chat, compaction, advisor, probes, retries and child-process egress are not yet all routed through this authority",
});
export function requireFormalBudgetRuntime() {
  throw budgetError(
    "CC_BUDGET_RUNTIME_NOT_COVERED",
    FORMAL_BUDGET_RUNTIME_READINESS.reason,
  );
}

// JSON.parse alone accepts duplicate keys (including escaped aliases) and
// overflows numeric literals to Infinity. Neither is safe accounting evidence.
export function parseBudgetJson(text) {
  requireBudget(typeof text === "string", "JSON text required");
  let at = 0;
  const whitespace = () => {
    while (at < text.length && /[\x20\t\r\n]/u.test(text[at])) at++;
  };
  function string() {
    requireBudget(text[at] === '"', "JSON string expected");
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') return JSON.parse(text.slice(start, at));
      if (char === "\\") at++;
    }
    requireBudget(false, "Unterminated JSON string");
  }
  function value(depth) {
    requireBudget(depth <= 64, "JSON nesting exceeds accounting parser bound");
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
        requireBudget(
          !keys.has(key),
          "Duplicate JSON member in provider evidence",
        );
        keys.add(key);
        whitespace();
        requireBudget(text[at++] === ":", "JSON member separator expected");
        value(depth + 1);
        whitespace();
        const separator = text[at++];
        if (separator === "}") return;
        requireBudget(separator === ",", "JSON object separator expected");
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
        requireBudget(separator === ",", "JSON array separator expected");
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
    requireBudget(
      number && Number.isFinite(Number(number)),
      "Invalid or non-finite JSON number",
    );
    at += number.length;
  }
  value(0);
  whitespace();
  requireBudget(at === text.length, "Trailing JSON input");
  return JSON.parse(text);
}

/** Allowlist only; the caller must still supply the existing OS sandbox. */
export function formalBudgetTaskEnvironment(environment = process.env) {
  return Object.fromEntries(
    [
      "PATH",
      "Path",
      "SystemRoot",
      "SYSTEMROOT",
      "WINDIR",
      "ComSpec",
      "PATHEXT",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
    ]
      .filter((key) => typeof environment[key] === "string")
      .map((key) => [key, environment[key]]),
  );
}

async function boundedText(response, maximumBytes) {
  requireBudget(response.body?.getReader, "Response body unavailable");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireBudget(
        size <= maximumBytes,
        "Provider response exceeded bounded parser",
      );
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* keep original unknown outcome */
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}
function streamReceipt(text) {
  let terminal = false,
    receipt = null,
    usage = null,
    finishReason = null;
  for (const frame of text.replaceAll("\r\n", "\n").split("\n\n")) {
    if (!frame.trim()) continue;
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    requireBudget(!terminal, "Unexpected stream data after terminal marker");
    if (data === "[DONE]") {
      requireBudget(
        finishReason !== null,
        "Stream ended without a completed choice",
      );
      terminal = true;
      continue;
    }
    const row = parseBudgetJson(data);
    requireBudget(row && !Object.hasOwn(row, "error"), "Provider stream error");
    const identity = {
      id: row.id,
      model: row.model,
      service_tier: row.service_tier,
    };
    if (!receipt) receipt = identity;
    else {
      // Some providers only send service_tier on the final usage frame.
      requireBudget(
        row.id === receipt.id && row.model === receipt.model,
        "Stream identity changed",
      );
      if (row.service_tier !== undefined) {
        requireBudget(
          receipt.service_tier === undefined ||
            row.service_tier === receipt.service_tier,
          "Stream tier changed",
        );
        receipt.service_tier = row.service_tier;
      }
    }
    requireBudget(
      Array.isArray(row.choices) &&
        row.choices.length <= 1 &&
        row.choices.every((choice) => choice.index === 0),
      "Multiple/unknown streamed completions",
    );
    for (const choice of row.choices) {
      requireBudget(
        finishReason === null,
        "Choice data received after completed stream choice",
      );
      if (choice.finish_reason != null) {
        requireBudget(
          ["stop", "length", "tool_calls"].includes(choice.finish_reason),
          "Unsupported stream finish reason",
        );
        finishReason = choice.finish_reason;
      }
    }
    if (row.usage != null) {
      requireBudget(
        finishReason !== null,
        "Usage received before complete stream choice",
      );
      requireBudget(
        usage === null || canonical(usage) === canonical(row.usage),
        "Conflicting streamed usage",
      );
      usage = row.usage;
    }
  }
  requireBudget(
    terminal && finishReason !== null && receipt && usage,
    "Incomplete stream or missing usage",
  );
  return { ...receipt, usage };
}

/**
 * Trusted-host JSON/SSE transport: credential stays in this closure, and every
 * physical request consumes a durable dispatch exactly once. No auto retries.
 * This is not the unrestricted Agent/Chat transport and is not auto-enabled.
 */
export function createFormalBudgetTransport({
  authority,
  credentialProvider,
  fetchImpl = globalThis.fetch,
  maximumResponseBytes = 16 * 1024 * 1024,
  timeoutMs = 60_000,
}) {
  requireBudget(
    authority &&
      typeof credentialProvider === "function" &&
      typeof fetchImpl === "function",
    "Authority and trusted credential provider required",
  );
  requireBudget(
    Number.isSafeInteger(maximumResponseBytes) &&
      maximumResponseBytes > 0 &&
      maximumResponseBytes <= 16 * 1024 * 1024,
    "Invalid response byte bound",
  );
  requireBudget(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000,
    "Invalid timeout",
  );
  return Object.freeze({
    async dispatch({ runId, callId, body, signal }) {
      // Snapshot before await so caller mutation cannot alter the reserved body.
      const request = JSON.parse(canonical(body));
      authority.reserve({ runId, callId, body: request });
      let settled = false;
      try {
        const reserved = authority.reservedContract(callId);
        const credential = await credentialProvider({
          contractId: reserved.id,
          provider: reserved.provider,
          endpoint: reserved.endpoint,
        });
        requireBudget(
          typeof credential === "string" &&
            credential.length > 0 &&
            !/[\r\n]/u.test(credential),
          "Credential unavailable",
        );
        const deadline = AbortSignal.timeout(timeoutMs);
        const options = {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credential}`,
          },
          body: JSON.stringify(request),
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        };
        // Final expiry/request check is AFTER every awaited preparation. There
        // must be no await between this durable admission and physical fetch.
        const contract = authority.markDispatched(callId, request);
        const response = await fetchImpl(contract.endpoint, options);
        requireBudget(response.ok, "Provider HTTP response not successful");
        const text = await boundedText(response, maximumResponseBytes);
        let receipt;
        if (request.stream === true) {
          requireBudget(
            response.headers.get("content-type")?.includes("text/event-stream"),
            "Unexpected stream content type",
          );
          receipt = streamReceipt(text);
        } else {
          receipt = parseBudgetJson(text);
          requireBudget(
            receipt && !Object.hasOwn(receipt, "error"),
            "Provider error envelope cannot settle",
          );
          requireBudget(
            Array.isArray(receipt.choices) &&
              receipt.choices.length === 1 &&
              receipt.choices[0].index === 0 &&
              ["stop", "length", "tool_calls"].includes(
                receipt.choices[0].finish_reason,
              ),
            "Incomplete or multiple completion response",
          );
        }
        const cost = authority.settle(callId, receipt);
        settled = true;
        return { body: text, streaming: request.stream === true, cost };
      } catch {
        if (!settled) {
          // Do not persist provider errors which may contain credentials/content.
          authority.markUnknown(
            callId,
            "transport or settlement outcome unknown",
          );
        }
        throw budgetError(
          "CC_BUDGET_TRANSPORT_UNKNOWN",
          "Provider outcome unknown; reservation retained and further dispatch blocked",
        );
      }
    },
  });
}
