/** OpenAI-only diagnostic transport. It grants no formal paid admission. */
import {
  createBoundedDiagnosticBroker,
  parseDiagnosticJson,
  requestFixedDiagnosticEndpoint,
} from "./verify01-volcengine-diagnostic-broker.mjs";

export const OPENAI_BROKER = Object.freeze({
  endpoint: "https://api.openai.com/v1/responses",
  provider: "openai",
  model: "gpt-6.1-sol",
  protocol: "responses",
  maximumRequestsPerTask: 24,
  maximumRequestBytes: 256 * 1024,
  maximumResponseBytes: 16 * 1024 * 1024,
  maximumAnswerTokens: 8192,
  timeoutMs: 180000,
  connectionAttemptTimeoutMs: 2000,
  formalSample: false,
  pricingSource: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
  standardUsdPerMillion: { input: 2, cachedInput: 0.1, output: 10 },
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
  if (!ok) throw new Error(`DIAGNOSTIC_OPENAI_${code}`);
};

export function openAiDiagnosticBody(
  input,
  { allowTextOnlyRequests = false } = {},
) {
  check(
    input && typeof input === "object" && !Array.isArray(input),
    "BODY_INVALID",
  );
  check(input.model === OPENAI_BROKER.model, "MODEL_MISMATCH");
  check(Array.isArray(input.input) && input.input.length > 0, "INPUT_REQUIRED");
  check(
    input.stream === undefined || typeof input.stream === "boolean",
    "STREAM_INVALID",
  );
  check(
    input.service_tier === undefined ||
      ["auto", "default"].includes(input.service_tier),
    "TIER_MISMATCH",
  );
  check(
    !input.previous_response_id && !input.conversation && !input.background,
    "REMOTE_STATE_FORBIDDEN",
  );
  check(
    (allowTextOnlyRequests && input.tools === undefined) ||
      (Array.isArray(input.tools) &&
        (allowTextOnlyRequests || input.tools.length > 0) &&
        input.tools.every(
          (tool) => tool?.type === "function" && fileTools.has(tool.name),
        )),
    "FILE_TOOLS_REQUIRED",
  );
  for (const item of input.input) {
    check(
      item && typeof item === "object" && !Array.isArray(item),
      "INPUT_ITEM_INVALID",
    );
    check(
      [
        undefined,
        "message",
        "reasoning",
        "function_call",
        "function_call_output",
      ].includes(item.type),
      "INPUT_ITEM_TYPE_FORBIDDEN",
    );
    if (item.type === "reasoning")
      check(Array.isArray(item.summary), "REASONING_SUMMARY_REQUIRED");
    if (item.type === "function_call")
      check(fileTools.has(item.name), "INPUT_TOOL_FORBIDDEN");
    if (Array.isArray(item.content)) {
      check(
        item.content.every((part) =>
          ["input_text", "output_text", "refusal"].includes(part?.type),
        ),
        "REMOTE_INPUT_FORBIDDEN",
      );
    }
  }
  if (input.max_output_tokens !== undefined)
    check(
      Number.isSafeInteger(input.max_output_tokens) &&
        input.max_output_tokens > 0,
      "OUTPUT_POLICY_INVALID",
    );
  const body = {
    ...input,
    store: false,
    service_tier: "default",
    max_output_tokens: Math.min(
      input.max_output_tokens ?? OPENAI_BROKER.maximumAnswerTokens,
      OPENAI_BROKER.maximumAnswerTokens,
    ),
  };
  check(
    Buffer.byteLength(JSON.stringify(body)) <=
      OPENAI_BROKER.maximumRequestBytes,
    "REQUEST_BYTES_LIMIT",
  );
  return body;
}

export function openAiDiagnosticJsonUsage(raw) {
  const response = typeof raw === "string" ? parseDiagnosticJson(raw) : raw;
  check(response && !response.error, "PROVIDER_ERROR");
  check(
    typeof response.id === "string" && response.id.length > 0,
    "RESPONSE_ID_UNKNOWN",
  );
  check(response.model === OPENAI_BROKER.model, "RESPONSE_MODEL_UNKNOWN");
  check(response.service_tier === "default", "RESPONSE_TIER_UNKNOWN");
  check(
    ["completed", "incomplete"].includes(response.status),
    "RESPONSE_INCOMPLETE",
  );
  check(Array.isArray(response.output), "OUTPUT_UNKNOWN");
  check(
    response.output.every(
      (item) =>
        ["message", "reasoning", "function_call"].includes(item?.type) &&
        (item.type !== "function_call" || fileTools.has(item.name)),
    ),
    "OUTPUT_TOOL_FORBIDDEN",
  );
  const usage = response.usage;
  check(
    usage &&
      [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ),
    "USAGE_UNKNOWN",
  );
  check(
    usage.total_tokens === usage.input_tokens + usage.output_tokens,
    "USAGE_INCONSISTENT",
  );
  check(
    usage.output_tokens <= OPENAI_BROKER.maximumAnswerTokens,
    "OUTPUT_LIMIT_EXCEEDED",
  );
  const cached = usage.input_tokens_details?.cached_tokens;
  check(
    Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.input_tokens,
    "CACHE_USAGE_UNKNOWN",
  );
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  check(
    Number.isSafeInteger(reasoning) &&
      reasoning >= 0 &&
      reasoning <= usage.output_tokens,
    "REASONING_USAGE_UNKNOWN",
  );
  const longContext = usage.input_tokens > 272000;
  const prices = OPENAI_BROKER.standardUsdPerMillion;
  return {
    usage,
    finish:
      response.status === "incomplete"
        ? "length"
        : response.output.some((item) => item.type === "function_call")
          ? "tool_calls"
          : "stop",
    tokenOnlyEstimateUsd:
      ((usage.input_tokens - cached) * prices.input * (longContext ? 2 : 1) +
        cached * prices.cachedInput * (longContext ? 2 : 1) +
        usage.output_tokens * prices.output * (longContext ? 1.5 : 1)) /
      1e6,
    estimateExcludesUnreportedCacheWritesAndOtherFees: true,
    responseId: response.id,
    model: response.model,
    serviceTier: response.service_tier,
  };
}

export function openAiDiagnosticUsage(raw) {
  let terminal = null;
  let sequence = -1;
  let done = false;
  let responseId = null;
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    check(!done, "EVENT_AFTER_DONE");
    if (data === "[DONE]") {
      check(terminal !== null, "TERMINAL_MISSING");
      done = true;
      continue;
    }
    check(terminal === null, "EVENT_AFTER_TERMINAL");
    const event = parseDiagnosticJson(data);
    check(!event.error && event.type !== "error", "PROVIDER_ERROR");
    check(
      Number.isSafeInteger(event.sequence_number) &&
        event.sequence_number > sequence,
      "SEQUENCE_INVALID",
    );
    sequence = event.sequence_number;
    if (event.response) {
      check(
        event.response.model === OPENAI_BROKER.model,
        "RESPONSE_MODEL_UNKNOWN",
      );
      check(
        responseId === null || responseId === event.response.id,
        "RESPONSE_ID_MISMATCH",
      );
      responseId = event.response.id;
    }
    check(
      !["response.failed", "response.cancelled"].includes(event.type),
      "RESPONSE_FAILED",
    );
    if (["response.completed", "response.incomplete"].includes(event.type))
      terminal = openAiDiagnosticJsonUsage(event.response);
  }
  check(terminal !== null, "TERMINAL_MISSING");
  return terminal;
}

export function requestOpenAi(body, key, options = {}) {
  return requestFixedDiagnosticEndpoint(body, key, options, OPENAI_BROKER);
}

export async function createOpenAiDiagnosticBroker(options) {
  return createBoundedDiagnosticBroker(options, {
    policy: OPENAI_BROKER,
    route: "/v1/responses",
    basePath: "/v1",
    request: requestOpenAi,
    body: openAiDiagnosticBody,
    sseUsage: openAiDiagnosticUsage,
    jsonUsage: openAiDiagnosticJsonUsage,
    estimateField: "tokenOnlyEstimateUsd",
    billedField: "actualBilledCostUsd",
    defaultThinkingPreserved: true,
  });
}
