import { randomUUID } from "node:crypto";
import { raceWithAbort } from "./abort-utils.js";
import {
  budgetError,
  canonical,
  label,
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

function providerReceipt(text, streaming) {
  if (streaming) return streamReceipt(text);
  const receipt = parseBudgetJson(text);
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
  return receipt;
}

/**
 * Trusted-host JSON/SSE transport: credential stays in this closure, and every
 * physical request consumes a durable dispatch exactly once. No auto retries.
 * createFetch is for an explicitly scoped, in-process host. It delivers chunks
 * as they arrive, but EOF is observable only after durable settlement. Missing
 * usage, cancellation and abandoned bodies retain the full reservation.
 * Neither API is auto-enabled or an OS/descendant isolation boundary.
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
  async function open({ runId, callId, body, endpoint, signal, traceId }) {
    signal?.throwIfAborted();
    // Snapshot before await so caller mutation cannot alter the reserved body.
    const request = JSON.parse(canonical(body));
    authority.reserve({ runId, callId, body: request, endpoint });
    const controller = new AbortController();
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
      ...(signal ? [signal] : []),
    ]);
    let finished = false,
      reader,
      responseBody,
      output,
      cost;
    const cleanup = () => combined.removeEventListener("abort", onAbort);
    const unknown = () => {
      const error = budgetError(
        "CC_BUDGET_TRANSPORT_UNKNOWN",
        "Provider outcome unknown; reservation retained and further dispatch blocked",
      );
      if (!finished) {
        finished = true;
        cleanup();
        // Never persist provider errors, content or credentials.
        try {
          authority.markUnknown(
            callId,
            "transport or settlement outcome unknown",
          );
        } catch {
          // The durable held/dispatched row still blocks another reservation.
          // An abort event must not throw an uncaught storage error.
        } finally {
          output?.error(error);
          controller.abort();
          // Do not let a peer that ignores cancellation block local shutdown.
          if (reader)
            void reader
              .cancel()
              .catch(() => {})
              .finally(() => {
                try {
                  reader.releaseLock();
                } catch {
                  /* another read is unwinding */
                }
              });
          else if (responseBody) void responseBody.cancel().catch(() => {});
        }
      }
      return error;
    };
    function onAbort() {
      unknown();
    }
    combined.addEventListener("abort", onAbort, { once: true });
    try {
      const reserved = authority.reservedContract(callId);
      const credential = await raceWithAbort(
        Promise.resolve().then(() =>
          credentialProvider({
            contractId: reserved.id,
            provider: reserved.provider,
            endpoint: reserved.endpoint,
          }),
        ),
        combined,
      );
      combined.throwIfAborted();
      requireBudget(
        typeof credential === "string" &&
          credential.length > 0 &&
          !/[\r\n]/u.test(credential),
        "Credential unavailable",
      );
      const options = {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential}`,
          ...(traceId ? { "X-Client-Request-Id": traceId } : {}),
        },
        body: JSON.stringify(request),
        signal: combined,
      };
      // No await between durable admission and physical fetch.
      const contract = authority.markDispatched(callId, request);
      const pendingResponse = Promise.resolve(
        fetchImpl(contract.endpoint, options),
      );
      // Dispose a late response even when the peer ignores AbortSignal.
      void pendingResponse
        .then((response) => {
          responseBody = response.body;
          if (finished && responseBody)
            void responseBody.cancel().catch(() => {});
        })
        .catch(() => {});
      const response = await raceWithAbort(pendingResponse, combined);
      combined.throwIfAborted();
      requireBudget(response.ok, "Provider HTTP response not successful");
      requireBudget(response.body?.getReader, "Response body unavailable");
      if (request.stream === true)
        requireBudget(
          response.headers.get("content-type")?.includes("text/event-stream"),
          "Unexpected stream content type",
        );
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      const stream = new ReadableStream(
        {
          start(streamController) {
            output = streamController;
          },
          async pull(streamController) {
            try {
              combined.throwIfAborted();
              const { done, value } = await reader.read();
              combined.throwIfAborted();
              if (done) {
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks, size),
                );
                cost = authority.settle(
                  callId,
                  providerReceipt(text, request.stream === true),
                );
                finished = true;
                cleanup();
                reader.releaseLock();
                streamController.close();
                return;
              }
              size += value.byteLength;
              requireBudget(
                size <= maximumResponseBytes,
                "Provider response exceeded bounded parser",
              );
              const chunk = Buffer.from(value);
              chunks.push(chunk);
              // Keep a private accounting snapshot; consumers may mutate bytes.
              streamController.enqueue(new Uint8Array(chunk));
            } catch {
              unknown();
            }
          },
          cancel() {
            unknown();
          },
        },
        { highWaterMark: 0 },
      );
      return {
        response: new Response(stream, {
          status: response.status,
          headers: response.headers,
        }),
        cost: () => cost,
        streaming: request.stream === true,
      };
    } catch {
      throw unknown();
    }
  }

  return Object.freeze({
    async dispatch(options) {
      const result = await open(options);
      const body = await result.response.text();
      return {
        body,
        streaming: result.streaming,
        cost: result.cost(),
      };
    },
    createFetch({ runId }) {
      label(runId, "run ID");
      return async (endpoint, init = {}) => {
        requireBudget(
          typeof endpoint === "string" &&
            init.method === "POST" &&
            typeof init.body === "string" &&
            Object.keys(init).every((key) =>
              ["method", "headers", "body", "signal", "redirect"].includes(key),
            ),
          "Budget fetch requires an explicit JSON POST without transport overrides",
        );
        const headers = new Headers(init.headers);
        requireBudget(
          /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
            headers.get("content-type") || "",
          ) &&
            [...headers.keys()].every((key) =>
              ["content-type", "authorization", "x-client-request-id"].includes(
                key,
              ),
            ),
          "Unsupported provider headers in budget scope",
        );
        const traceId = headers.get("x-client-request-id");
        requireBudget(!traceId || traceId.length <= 512, "Invalid trace ID");
        const result = await open({
          runId,
          callId: randomUUID(),
          endpoint,
          body: parseBudgetJson(init.body),
          signal: init.signal,
          traceId,
        });
        return result.response;
      };
    },
  });
}
