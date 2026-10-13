import { createHash } from "node:crypto";

export function budgetError(code, message) {
  return Object.assign(new Error(message), { code });
}
export function requireBudget(condition, message, code = "CC_BUDGET_INVALID") {
  if (!condition) throw budgetError(code, message);
}
export function integer(value, name, minimum = 0) {
  requireBudget(
    Number.isSafeInteger(value) && value >= minimum,
    `${name} must be a safe integer >= ${minimum}`,
  );
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  requireBudget(
    value !== undefined &&
      (typeof value !== "number" || Number.isFinite(value)),
    "Non-JSON evidence",
  );
  return JSON.stringify(value);
}
export const evidenceDigest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function label(value, name) {
  requireBudget(
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value),
    `Invalid ${name}`,
  );
  return value;
}
function digest(value, name) {
  requireBudget(
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value),
    `Missing ${name} digest`,
  );
}
function validity(value, now) {
  integer(value.validFrom, "validFrom");
  integer(value.validUntil, "validUntil", 1);
  requireBudget(
    value.validFrom <= now && now < value.validUntil,
    "Contract or FX receipt expired",
    "CC_BUDGET_EXPIRED",
  );
}
function verified(kind, subject, receipt, verifyEvidence) {
  requireBudget(
    receipt && typeof receipt.id === "string" && receipt.id.length > 0,
    `Missing ${kind} account evidence`,
    "CC_BUDGET_EVIDENCE_REQUIRED",
  );
  digest(receipt.sha256, kind);
  requireBudget(
    verifyEvidence({
      kind,
      subjectDigest: evidenceDigest(subject),
      receipt,
    }) === true,
    `Unverified ${kind} evidence`,
    "CC_BUDGET_EVIDENCE_REQUIRED",
  );
}

// Verification is supplied by the trusted host, never by task JSON/environment.
// There is deliberately no default verifier and no public-price activation.
export function validateActivation(config, verifyEvidence, now = Date.now()) {
  requireBudget(
    typeof verifyEvidence === "function",
    "Trusted evidence verifier required",
    "CC_BUDGET_EVIDENCE_REQUIRED",
  );
  const { plan, contracts, fx, history, evidence } = config;
  requireBudget(
    plan &&
      Array.isArray(contracts) &&
      Array.isArray(fx) &&
      history &&
      evidence,
    "Incomplete activation facts",
    "CC_BUDGET_EVIDENCE_REQUIRED",
  );
  label(plan.lineageId, "lineage ID");
  digest(plan.digest, "frozen plan");
  requireBudget(
    plan.limitUsdMicros === 99_000_000,
    "Original lineage ceiling must be $99",
  );
  requireBudget(
    Array.isArray(plan.tasks) && plan.tasks.length === 45,
    "Frozen plan needs 36 tasks and 9 soaks",
  );
  requireBudget(
    new Set(plan.tasks.map((task) => task.id)).size === 45,
    "Duplicate task ID",
  );
  requireBudget(
    plan.tasks.filter((task) => task.kind === "task").length === 36 &&
      plan.tasks.filter((task) => task.kind === "soak").length === 9,
    "Frozen allocation changed",
  );
  for (const task of plan.tasks) {
    label(task.id, "task ID");
    label(task.contractId, "contract ID");
    requireBudget(
      task.capUsdMicros === (task.kind === "task" ? 2_000_000 : 3_000_000),
      "Task cap changed",
    );
  }
  requireBudget(
    new Set(contracts.map((c) => c.id)).size === contracts.length,
    "Duplicate contract ID",
  );
  requireBudget(
    new Set(fx.map((c) => c.currency)).size === fx.length,
    "Duplicate currency conversion",
  );
  for (const contract of contracts) {
    label(contract.id, "contract ID");
    label(contract.provider, "provider");
    label(contract.model, "model");
    const url = new URL(contract.endpoint);
    requireBudget(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname.endsWith("/chat/completions"),
      "Only exact HTTPS Chat endpoint supported",
    );
    requireBudget(
      contract.protocol === "openai-chat" &&
        /^[A-Z]{3}$/u.test(contract.currency),
      "Unsupported billing protocol/currency",
    );
    requireBudget(
      contract.defaultThinkingPreserved === true &&
        contract.allBilledDimensionsBounded === true,
      "Complete default-thinking liability ceiling required",
    );
    const envelope = contract.inputEnvelope;
    requireBudget(
      envelope?.kind === "json-utf8-byte-ceiling/v1" &&
        envelope.requestSchema === "text-function-chat/v1" &&
        envelope.includesMessagesToolsAndProviderFraming === true &&
        envelope.includesAllBilledInputAndImplicitSystemOverhead === true,
      "Verified inclusive input envelope required",
      "CC_BUDGET_EVIDENCE_REQUIRED",
    );
    integer(envelope.maximumRequestBytes, "maximumRequestBytes", 1);
    integer(
      envelope.inclusivePromptTokenUpperBound,
      "inclusivePromptTokenUpperBound",
      1,
    );
    requireBudget(
      envelope.inclusivePromptTokenUpperBound <= contract.maxInputTokens,
      "Input envelope exceeds reserved prompt bound",
    );
    validity(contract, now);
    for (const name of [
      "maxInputTokens",
      "maxAnswerTokens",
      "maxReasoningTokens",
      "inputMicrosPerMillion",
      "cachedMicrosPerMillion",
      "outputMicrosPerMillion",
      "fixedFeeMicros",
    ])
      integer(contract[name], name);
    requireBudget(
      contract.maxInputTokens > 0 &&
        contract.maxAnswerTokens > 0 &&
        contract.inputMicrosPerMillion > 0 &&
        contract.outputMicrosPerMillion > 0,
      "Unbounded or unpriced contract",
    );
    requireBudget(
      contract.cachedMicrosPerMillion <= contract.inputMicrosPerMillion,
      "Cache cannot exceed reserved input price",
    );
    requireBudget(
      Array.isArray(contract.responseTiers) &&
        contract.responseTiers.length > 0 &&
        contract.responseTiers.every(
          (x) => typeof x === "string" && x.length > 0,
        ),
      "Exact response tier mapping required",
    );
    verified(
      "contract",
      contract,
      evidence.contracts?.[contract.id],
      verifyEvidence,
    );
    requireBudget(
      fx.some((item) => item.currency === contract.currency),
      "Missing native currency conversion ceiling",
    );
  }
  for (const rate of fx) {
    validity(rate, now);
    integer(rate.numerator, "FX numerator", 1);
    integer(rate.denominator, "FX denominator", 1);
    requireBudget(
      rate.includesSettlementFees === true,
      "FX ceiling must include settlement fees",
    );
    verified("fx", rate, evidence.fx?.[rate.currency], verifyEvidence);
  }
  for (const task of plan.tasks)
    requireBudget(
      contracts.some((c) => c.id === task.contractId),
      "Task contract missing",
    );
  const taskProviders = plan.tasks
    .filter((task) => task.kind === "task")
    .map((task) => contracts.find((c) => c.id === task.contractId).provider);
  requireBudget(
    taskProviders.filter((provider) => provider === "volcengine").length ===
      18 &&
      taskProviders.filter((provider) => provider === "openai").length === 18,
    "Frozen task strata require 18 Volcengine and 18 OpenAI tasks",
  );
  requireBudget(
    history.lineageId === plan.lineageId &&
      history.planDigest === plan.digest &&
      history.complete === true,
    "Original lineage reconciliation required",
    "CC_BUDGET_HISTORY_REQUIRED",
  );
  requireBudget(
    Array.isArray(history.tasks) &&
      history.tasks.length === 45 &&
      new Set(history.tasks.map((t) => t.id)).size === 45,
    "All task history required",
  );
  let total = 0;
  for (const item of history.tasks) {
    const task = plan.tasks.find((t) => t.id === item.id);
    requireBudget(task, "Unknown historical task");
    integer(item.spentUsdMicros, "Historical spend");
    integer(item.reservedUsdMicros, "Historical unknown liability");
    integer(item.runsUsed, "Historical run slots");
    requireBudget(
      item.runsUsed <= 2,
      "Historical task exceeded remediation slots",
    );
    requireBudget(
      typeof item.unknown === "boolean",
      "Historical unknown flag required",
    );
    requireBudget(
      item.reservedUsdMicros === 0 || item.unknown === true,
      "Historical reservation must stay unknown",
    );
    requireBudget(
      item.spentUsdMicros + item.reservedUsdMicros <= task.capUsdMicros,
      "Historical task cap exceeded",
    );
    total += item.spentUsdMicros + item.reservedUsdMicros;
  }
  requireBudget(
    total <= plan.limitUsdMicros,
    "Historical lineage cap exceeded",
  );
  verified("plan", plan, evidence.plan, verifyEvidence);
  verified("history", history, evidence.history, verifyEvidence);
  return JSON.parse(canonical(config));
}

function safeNumber(value) {
  requireBudget(
    value <= BigInt(Number.MAX_SAFE_INTEGER),
    "Money exceeds safe integer range",
  );
  return Number(value);
}
const ceil = (n, d) => (n + d - 1n) / d;
export function quoteNative(contract, usage = null) {
  const input = BigInt(usage?.prompt_tokens ?? contract.maxInputTokens);
  const cached = BigInt(usage?.prompt_tokens_details?.cached_tokens ?? 0);
  const output = usage
    ? BigInt(usage.completion_tokens)
    : BigInt(contract.maxAnswerTokens) + BigInt(contract.maxReasoningTokens);
  return safeNumber(
    ceil(
      (input - cached) * BigInt(contract.inputMicrosPerMillion) +
        cached * BigInt(contract.cachedMicrosPerMillion) +
        output * BigInt(contract.outputMicrosPerMillion),
      1_000_000n,
    ) + BigInt(contract.fixedFeeMicros),
  );
}
export function convertToUsd(nativeMicros, rate) {
  integer(nativeMicros, "Native cost");
  return safeNumber(
    ceil(
      BigInt(nativeMicros) * BigInt(rate.numerator),
      BigInt(rate.denominator),
    ),
  );
}
export function validateResponse(contract, response) {
  requireBudget(
    response && !Object.hasOwn(response, "error"),
    "Provider error envelope cannot settle",
  );
  requireBudget(response?.model === contract.model, "Unknown response model");
  requireBudget(
    contract.responseTiers.includes(response.service_tier),
    "Unknown response service tier",
  );
  requireBudget(
    typeof response.id === "string" &&
      response.id.length > 0 &&
      response.id.length <= 256,
    "Provider receipt ID required",
  );
  const usage = response.usage;
  requireBudget(usage && typeof usage === "object", "Missing provider usage");
  requireBudget(
    Object.keys(usage).every((key) =>
      [
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "prompt_tokens_details",
        "completion_tokens_details",
      ].includes(key),
    ) &&
      usage.prompt_tokens_details &&
      Object.keys(usage.prompt_tokens_details).every(
        (key) => key === "cached_tokens",
      ) &&
      usage.completion_tokens_details &&
      Object.keys(usage.completion_tokens_details).every(
        (key) => key === "reasoning_tokens",
      ),
    "Unsupported provider usage dimensions",
  );
  integer(usage.prompt_tokens, "prompt_tokens");
  integer(usage.completion_tokens, "completion_tokens");
  integer(usage.prompt_tokens_details?.cached_tokens, "cached_tokens");
  integer(
    usage.completion_tokens_details?.reasoning_tokens,
    "reasoning_tokens",
  );
  requireBudget(
    usage.prompt_tokens_details.cached_tokens <= usage.prompt_tokens,
    "Cache is not a subset of prompt",
  );
  requireBudget(
    usage.completion_tokens_details.reasoning_tokens <= usage.completion_tokens,
    "Reasoning is not a subset of completion",
  );
  requireBudget(
    usage.prompt_tokens <= contract.maxInputTokens &&
      usage.completion_tokens_details.reasoning_tokens <=
        contract.maxReasoningTokens &&
      usage.completion_tokens -
        usage.completion_tokens_details.reasoning_tokens <=
        contract.maxAnswerTokens,
    "Provider usage exceeds contract bound",
  );
  if (usage.total_tokens !== undefined)
    requireBudget(
      usage.total_tokens === usage.prompt_tokens + usage.completion_tokens,
      "Inconsistent total tokens",
    );
  return usage;
}
export function validateRequest(contract, body) {
  requireBudget(
    body &&
      body.model === contract.model &&
      Array.isArray(body.messages) &&
      body.messages.length > 0,
    "Exact model and messages required",
  );
  const keys = [
    "model",
    "messages",
    "stream",
    "stream_options",
    "tools",
    "tool_choice",
    "max_tokens",
    "temperature",
    "top_p",
    "stop",
    "n",
  ];
  requireBudget(
    Object.keys(body).every((key) => keys.includes(key)),
    "Unsupported request dimension or thinking override",
  );
  requireBudget(
    body.n === undefined || body.n === 1,
    "Only a single billed completion supported",
  );
  requireBudget(
    body.stream === undefined || typeof body.stream === "boolean",
    "Invalid stream flag",
  );
  if (body.stream_options !== undefined)
    requireBudget(
      canonical(body.stream_options) === '{"include_usage":true}',
      "Unsupported stream options",
    );
  if (body.max_tokens !== undefined) {
    integer(body.max_tokens, "max_tokens", 1);
    requireBudget(
      body.max_tokens <= contract.maxAnswerTokens,
      "Requested answer exceeds contract bound",
    );
  }
  const onlyKeys = (object, allowed) =>
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    Object.keys(object).every((key) => allowed.includes(key));
  const functionName = (name) =>
    typeof name === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(name);
  for (const message of body.messages) {
    requireBudget(
      onlyKeys(message, [
        "role",
        "content",
        "name",
        "tool_calls",
        "tool_call_id",
      ]),
      "Unsupported message input dimension",
    );
    requireBudget(
      ["system", "developer", "user", "assistant", "tool"].includes(
        message.role,
      ),
      "Unsupported message role",
    );
    requireBudget(
      typeof message.content === "string" ||
        (message.role === "assistant" &&
          message.content == null &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length > 0),
      "Only textual messages and function results are supported",
    );
    if (message.name !== undefined)
      requireBudget(functionName(message.name), "Invalid message name");
    if (message.tool_call_id !== undefined)
      requireBudget(
        message.role === "tool" &&
          typeof message.tool_call_id === "string" &&
          message.tool_call_id.length > 0,
        "Invalid function result",
      );
    if (message.role === "tool")
      requireBudget(
        typeof message.tool_call_id === "string",
        "Function result ID required",
      );
    if (message.tool_calls !== undefined) {
      requireBudget(
        message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length > 0,
        "Invalid function calls",
      );
      for (const call of message.tool_calls)
        requireBudget(
          onlyKeys(call, ["id", "type", "function"]) &&
            typeof call.id === "string" &&
            call.id.length > 0 &&
            call.type === "function" &&
            onlyKeys(call.function, ["name", "arguments"]) &&
            functionName(call.function.name) &&
            typeof call.function.arguments === "string",
          "Unsupported function call input",
        );
    }
  }
  if (body.tools !== undefined) {
    requireBudget(
      Array.isArray(body.tools) &&
        body.tools.every(
          (tool) =>
            onlyKeys(tool, ["type", "function"]) &&
            tool.type === "function" &&
            onlyKeys(tool.function, [
              "name",
              "description",
              "parameters",
              "strict",
            ]) &&
            functionName(tool.function.name) &&
            (tool.function.description === undefined ||
              typeof tool.function.description === "string") &&
            (tool.function.parameters === undefined ||
              (tool.function.parameters &&
                typeof tool.function.parameters === "object" &&
                !Array.isArray(tool.function.parameters))) &&
            (tool.function.strict === undefined ||
              typeof tool.function.strict === "boolean"),
        ),
      "Unbounded provider-hosted tools rejected",
    );
  }
  if (body.tool_choice !== undefined)
    requireBudget(
      ["none", "auto", "required"].includes(body.tool_choice) ||
        (onlyKeys(body.tool_choice, ["type", "function"]) &&
          body.tool_choice.type === "function" &&
          onlyKeys(body.tool_choice.function, ["name"]) &&
          functionName(body.tool_choice.function.name)),
      "Unsupported tool choice",
    );
  if (body.temperature !== undefined)
    requireBudget(
      typeof body.temperature === "number" &&
        Number.isFinite(body.temperature) &&
        body.temperature >= 0 &&
        body.temperature <= 2,
      "Invalid temperature",
    );
  if (body.top_p !== undefined)
    requireBudget(
      typeof body.top_p === "number" &&
        Number.isFinite(body.top_p) &&
        body.top_p > 0 &&
        body.top_p <= 1,
      "Invalid top_p",
    );
  if (body.stop !== undefined)
    requireBudget(
      typeof body.stop === "string" ||
        (Array.isArray(body.stop) &&
          body.stop.length <= 4 &&
          body.stop.every((item) => typeof item === "string")),
      "Invalid stop sequence",
    );
  requireBudget(
    contract.inputEnvelope?.kind === "json-utf8-byte-ceiling/v1" &&
      contract.inputEnvelope.requestSchema === "text-function-chat/v1" &&
      contract.inputEnvelope.includesMessagesToolsAndProviderFraming === true &&
      contract.inputEnvelope.includesAllBilledInputAndImplicitSystemOverhead ===
        true &&
      contract.inputEnvelope.inclusivePromptTokenUpperBound <=
        contract.maxInputTokens,
    "No verified inclusive input envelope",
  );
  requireBudget(
    Buffer.byteLength(canonical(body), "utf8") <=
      contract.inputEnvelope.maximumRequestBytes,
    "Serialized input exceeds verified envelope",
  );
  return evidenceDigest(body);
}
