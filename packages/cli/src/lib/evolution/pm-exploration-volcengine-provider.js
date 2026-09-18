import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isProxy } from "node:util/types";

import { createChatFn } from "../cowork-adapter.js";
import { loadConfig } from "../config-manager.js";
import { applyConfigLlmDefaults } from "../llm-config-defaults.js";
import { BUILT_IN_PROVIDERS } from "../llm-providers.js";
import { estimateCost, lookupRate, mergePricing } from "../llm-pricing.js";
import { captureAgentEvolutionIngress } from "./agent-evolution-ingress.js";

export const PM_EXPLORATION_VOLCENGINE_PROVIDER_SCHEMA =
  "chainlesschain.pm-exploration-volcengine-provider/v1";
export const PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA =
  "chainlesschain.pm-exploration-provider-settlement/v1";
export const PM_EXPLORATION_PROVIDER_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-provider-result/v1";
export const PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA =
  "chainlesschain.pm-exploration-provider-persistence/v1";

const PROVIDER = "volcengine";
const CLIENTS = new WeakMap();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const OPERATION_ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const MESSAGE_ROLES = new Set(["assistant", "system", "user"]);
const OPTION_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "evolutionIngress",
  "maxOutputTokens",
  "model",
  "persistSettlement",
  "pricing",
  "timeoutMs",
]);
const INVOCATION_KEYS = [
  "messages",
  "runtime",
  "maxOutputTokens",
  "operationId",
  "executionRequestDigest",
];
const MAX_MESSAGES = 16;
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function plainOptions(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !OPTION_KEYS.has(key) ||
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} contains unsupported fields`);
    }
  }
  return value;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function boundedString(value, label, maximum, { trim = true } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    (trim && value.trim() !== value) ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function normalizeBaseUrl(value) {
  const expected = BUILT_IN_PROVIDERS[PROVIDER].baseUrl;
  let parsed;
  try {
    parsed = new URL(value || expected);
  } catch {
    throw new TypeError("PM Volcengine provider baseUrl is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.href.replace(/\/$/u, "") !== expected.replace(/\/$/u, "")
  ) {
    throw new TypeError(
      "PM Volcengine provider baseUrl must match the credential-free built-in endpoint",
    );
  }
  return expected;
}

function localOptions(options) {
  let llm = {};
  try {
    const configured = loadConfig()?.llm;
    if (
      configured &&
      typeof configured === "object" &&
      !Array.isArray(configured)
    ) {
      llm = configured;
    }
  } catch {
    llm = {};
  }
  if (
    !options.apiKey &&
    llm.provider &&
    llm.provider !== PROVIDER &&
    !process.env.VOLCENGINE_API_KEY
  ) {
    throw new Error("local LLM configuration is not Volcengine");
  }
  const resolved = { provider: PROVIDER };
  applyConfigLlmDefaults(resolved, llm, {
    explicitModel: options.model,
  });
  if (options.model !== undefined) resolved.model = options.model;
  if (options.baseUrl !== undefined) resolved.baseUrl = options.baseUrl;
  if (options.apiKey !== undefined) resolved.apiKey = options.apiKey;
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  return { llm, resolved };
}

function normalizeMessages(value) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 ||
    value.length > MAX_MESSAGES ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(
      `PM Volcengine messages must contain 1 to ${MAX_MESSAGES} dense entries`,
    );
  }
  let bytes = 0;
  const messages = value.map((entry, index) => {
    if (!Object.hasOwn(value, index))
      throw new TypeError("PM Volcengine messages cannot contain holes");
    exact(entry, ["role", "content"], `PM Volcengine message ${index}`);
    if (!MESSAGE_ROLES.has(entry.role))
      throw new TypeError(`PM Volcengine message ${index} role is invalid`);
    const content = boundedString(
      entry.content,
      `PM Volcengine message ${index} content`,
      MAX_PROMPT_BYTES,
      { trim: false },
    );
    if (content.trim().length === 0)
      throw new TypeError(`PM Volcengine message ${index} content is empty`);
    bytes += Buffer.byteLength(content, "utf8");
    return Object.freeze({ role: entry.role, content });
  });
  if (bytes > MAX_PROMPT_BYTES)
    throw new TypeError(
      `PM Volcengine prompt exceeds ${MAX_PROMPT_BYTES} bytes`,
    );
  return Object.freeze(messages);
}

function normalizeRuntime(value) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    !(value.signal instanceof AbortSignal) ||
    typeof value.recordTokens !== "function" ||
    typeof value.snapshot !== "function"
  ) {
    throw new TypeError(
      "PM Volcengine invocation requires a budget runtime capability",
    );
  }
  return value;
}

function usageInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Volcengine response did not include accountable usage");
  }
  const usage = Object.freeze({
    inputTokens: usageInteger(value.input_tokens, "usage.input_tokens"),
    outputTokens: usageInteger(value.output_tokens, "usage.output_tokens"),
    cacheReadTokens: usageInteger(
      value.cache_read_input_tokens,
      "usage.cache_read_input_tokens",
    ),
    cacheCreationTokens: usageInteger(
      value.cache_creation_input_tokens,
      "usage.cache_creation_input_tokens",
    ),
  });
  const totalTokens = Object.values(usage).reduce((sum, count) => {
    const next = sum + count;
    if (!Number.isSafeInteger(next))
      throw new TypeError(
        "Volcengine usage total exceeds the safe integer range",
      );
    return next;
  }, 0);
  if (totalTokens === 0)
    throw new Error("Volcengine response reported zero accountable tokens");
  return Object.freeze({ ...usage, totalTokens });
}

function normalizePersistence(value, settlementDigest) {
  exact(
    value,
    ["schema", "settlementDigest", "persisted", "durable", "recordDigest"],
    "PM provider settlement persistence",
  );
  if (
    value.schema !== PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA ||
    value.settlementDigest !== settlementDigest ||
    value.persisted !== true ||
    value.durable !== true ||
    typeof value.recordDigest !== "string" ||
    !DIGEST.test(value.recordDigest)
  ) {
    throw new Error("PM provider settlement persistence was not durable");
  }
  return deepFreeze({ ...value });
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be a finite non-negative number`);
  return value;
}

function normalizeEstimatedCost(value, usage) {
  exact(
    value,
    [
      "currency",
      "input",
      "output",
      "cacheRead",
      "cacheCreation",
      "total",
      "rate",
    ],
    "PM Volcengine estimated cost",
  );
  exact(
    value.rate,
    ["in", "out", "pattern", "cacheReadMultiplier", "cacheCreationMultiplier"],
    "PM Volcengine cost rate",
  );
  if (value.currency !== "USD")
    throw new TypeError("PM Volcengine estimated cost currency is invalid");
  const rate = Object.freeze({
    in: finiteNumber(value.rate.in, "PM Volcengine cost rate.in"),
    out: finiteNumber(value.rate.out, "PM Volcengine cost rate.out"),
    cacheReadMultiplier: finiteNumber(
      value.rate.cacheReadMultiplier,
      "PM Volcengine cost rate.cacheReadMultiplier",
    ),
    cacheCreationMultiplier: finiteNumber(
      value.rate.cacheCreationMultiplier,
      "PM Volcengine cost rate.cacheCreationMultiplier",
    ),
    pattern: boundedString(
      value.rate.pattern,
      "PM Volcengine cost rate.pattern",
      256,
    ),
  });
  const expected = Object.freeze({
    input: (usage.inputTokens / 1e6) * rate.in,
    output: (usage.outputTokens / 1e6) * rate.out,
    cacheRead:
      (usage.cacheReadTokens / 1e6) * rate.in * rate.cacheReadMultiplier,
    cacheCreation:
      (usage.cacheCreationTokens / 1e6) *
      rate.in *
      rate.cacheCreationMultiplier,
  });
  const result = Object.freeze({
    currency: value.currency,
    input: finiteNumber(value.input, "PM Volcengine estimated input cost"),
    output: finiteNumber(value.output, "PM Volcengine estimated output cost"),
    cacheRead: finiteNumber(
      value.cacheRead,
      "PM Volcengine estimated cache read cost",
    ),
    cacheCreation: finiteNumber(
      value.cacheCreation,
      "PM Volcengine estimated cache creation cost",
    ),
    total: finiteNumber(value.total, "PM Volcengine estimated total cost"),
    rate,
  });
  if (
    result.input !== expected.input ||
    result.output !== expected.output ||
    result.cacheRead !== expected.cacheRead ||
    result.cacheCreation !== expected.cacheCreation ||
    result.total !==
      expected.input +
        expected.output +
        expected.cacheRead +
        expected.cacheCreation
  ) {
    throw new Error("PM Volcengine estimated cost does not match usage");
  }
  return result;
}

function operationId(value) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !OPERATION_ID.test(value)
  ) {
    throw new TypeError("PM Volcengine operationId is invalid");
  }
  return value;
}

/**
 * Create a credential-closing, governed Volcengine egress for PM exploration.
 * Local CLI configuration is used only when the caller omits explicit model,
 * endpoint or credential values. The returned object exposes no secret fields.
 */
export function createPmExplorationVolcengineProvider(options = {}) {
  plainOptions(options, "PM Volcengine provider options");
  const { llm, resolved } = localOptions(options);
  const model = boundedString(
    resolved.model || BUILT_IN_PROVIDERS[PROVIDER].models[0],
    "PM Volcengine model",
    256,
  );
  const baseUrl = normalizeBaseUrl(
    resolved.baseUrl || BUILT_IN_PROVIDERS[PROVIDER].baseUrl,
  );
  const apiKey = boundedString(
    resolved.apiKey,
    "PM Volcengine credential",
    16 * 1024,
  );
  const maxOutputTokens = integer(
    options.maxOutputTokens ?? 2_048,
    "PM Volcengine maxOutputTokens",
    1,
    4_096,
  );
  const timeoutMs = integer(
    options.timeoutMs ?? 30_000,
    "PM Volcengine timeoutMs",
    1_000,
    120_000,
  );
  if (
    options.persistSettlement !== undefined &&
    (typeof options.persistSettlement !== "function" ||
      isProxy(options.persistSettlement))
  ) {
    throw new TypeError("persistSettlement must be a direct function");
  }
  const pricing = mergePricing(options.pricing ?? llm.pricing);
  const rate = lookupRate(PROVIDER, model, pricing);
  if (rate === null)
    throw new Error(
      `Volcengine model is unpriced for PM exploration: ${model}`,
    );
  const descriptor = deepFreeze({
    schema: PM_EXPLORATION_VOLCENGINE_PROVIDER_SCHEMA,
    provider: PROVIDER,
    model,
    endpointDigest: hash(PM_EXPLORATION_VOLCENGINE_PROVIDER_SCHEMA, baseUrl),
    maxOutputTokens,
    timeoutMs,
    pricingPattern: rate.pattern,
    settlementPersistenceRequired: options.persistSettlement !== undefined,
  });
  const provider = Object.freeze({});
  CLIENTS.set(provider, {
    apiKey,
    baseUrl,
    descriptor,
    evolutionIngress: captureAgentEvolutionIngress(options.evolutionIngress),
    maxOutputTokens,
    model,
    persistSettlement: options.persistSettlement ?? null,
    pricing,
    timeoutMs,
  });
  return provider;
}

export function inspectPmExplorationVolcengineProvider(value) {
  const client = CLIENTS.get(value);
  if (!client)
    throw new TypeError("a branded PM Volcengine provider is required");
  return client.descriptor;
}

/**
 * Revalidate the canonical no-secret settlement before it is added to a
 * signed execution trace or a replayable PM evidence bundle.
 */
export function verifyPmExplorationVolcengineSettlement(value) {
  exact(
    value,
    [
      "schema",
      "provider",
      "model",
      "operationId",
      "executionRequestDigest",
      "requestDigest",
      "responseDigest",
      "usage",
      "estimatedCost",
      "settlementDigest",
    ],
    "PM Volcengine settlement",
  );
  if (value.schema !== PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA)
    throw new TypeError("PM Volcengine settlement schema is invalid");
  if (value.provider !== PROVIDER)
    throw new TypeError("PM Volcengine settlement provider is invalid");
  const usage = normalizeUsage({
    input_tokens: value.usage?.inputTokens,
    output_tokens: value.usage?.outputTokens,
    cache_read_input_tokens: value.usage?.cacheReadTokens,
    cache_creation_input_tokens: value.usage?.cacheCreationTokens,
  });
  if (usage.totalTokens !== value.usage?.totalTokens)
    throw new Error("PM Volcengine settlement usage total is invalid");
  const core = deepFreeze({
    schema: value.schema,
    provider: value.provider,
    model: boundedString(value.model, "PM Volcengine settlement model", 256),
    operationId: operationId(value.operationId),
    executionRequestDigest: digest(
      value.executionRequestDigest,
      "PM Volcengine settlement executionRequestDigest",
    ),
    requestDigest: digest(
      value.requestDigest,
      "PM Volcengine settlement requestDigest",
    ),
    responseDigest: digest(
      value.responseDigest,
      "PM Volcengine settlement responseDigest",
    ),
    usage,
    estimatedCost: normalizeEstimatedCost(value.estimatedCost, usage),
  });
  if (
    digest(value.settlementDigest, "PM Volcengine settlementDigest") !==
    hash(PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA, core)
  ) {
    throw new Error("PM Volcengine settlement digest mismatch");
  }
  return deepFreeze({ ...core, settlementDigest: value.settlementDigest });
}

export function verifyPmExplorationVolcengineSettlementRecord(value) {
  exact(
    value,
    ["settlement", "persistence"],
    "PM Volcengine settlement record",
  );
  const settlement = verifyPmExplorationVolcengineSettlement(value.settlement);
  const persistence =
    value.persistence === null
      ? null
      : normalizePersistence(value.persistence, settlement.settlementDigest);
  return deepFreeze({ settlement, persistence });
}

/**
 * Invoke the real configured provider inside a host-issued budget capability.
 * Provider-reported usage is charged before any response is returned. Missing
 * usage, unpriced models, budget overflow and optional persistence failures are
 * all fail-closed outcomes for the surrounding budget executor.
 */
export async function invokePmExplorationVolcengine(value, input = {}) {
  const client = CLIENTS.get(value);
  if (!client)
    throw new TypeError("a branded PM Volcengine provider is required");
  exact(input, INVOCATION_KEYS, "PM Volcengine invocation");
  const messages = normalizeMessages(input.messages);
  const runtime = normalizeRuntime(input.runtime);
  const requestedOutputTokens = integer(
    input.maxOutputTokens,
    "PM Volcengine invocation maxOutputTokens",
    1,
    client.maxOutputTokens,
  );
  const boundOperationId = operationId(input.operationId);
  const executionRequestDigest = digest(
    input.executionRequestDigest,
    "PM Volcengine invocation executionRequestDigest",
  );
  const requestCore = {
    provider: PROVIDER,
    model: client.model,
    operationId: boundOperationId,
    maxOutputTokens: requestedOutputTokens,
    messages,
  };
  const requestDigest = hash(
    PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA,
    requestCore,
  );
  let settlement = null;
  let persistence = null;
  const startedAt = performance.now();
  const chat = createChatFn({
    provider: PROVIDER,
    model: client.model,
    baseUrl: client.baseUrl,
    apiKey: client.apiKey,
    evolutionIngress: client.evolutionIngress,
    callWrapper: async ({ call, provider, model }) => {
      if (provider !== PROVIDER || model !== client.model)
        throw new Error("PM Volcengine provider identity changed during call");
      const envelope = await call({ signal: runtime.signal });
      const content = boundedString(
        envelope?.content,
        "PM Volcengine response",
        MAX_RESPONSE_BYTES,
        { trim: false },
      );
      if (content.trim().length === 0)
        throw new Error("Volcengine response content is empty");
      const usage = normalizeUsage(envelope?.usage);
      runtime.recordTokens(usage.totalTokens);
      const estimated = estimateCost({
        provider: PROVIDER,
        model: client.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        table: client.pricing,
      });
      if (!estimated.matched || estimated.currency !== "USD")
        throw new Error("Volcengine usage could not be priced");
      const settlementCore = deepFreeze({
        schema: PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA,
        provider: PROVIDER,
        model: client.model,
        operationId: boundOperationId,
        executionRequestDigest,
        requestDigest,
        responseDigest: hash(
          PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA,
          content,
        ),
        usage,
        estimatedCost: {
          currency: estimated.currency,
          input: estimated.inputCost,
          output: estimated.outputCost,
          cacheRead: estimated.cacheReadCost,
          cacheCreation: estimated.cacheCreationCost,
          total: estimated.totalCost,
          rate: {
            ...estimated.rate,
            cacheReadMultiplier: 0.1,
            cacheCreationMultiplier: 1.25,
          },
        },
      });
      settlement = deepFreeze({
        ...settlementCore,
        settlementDigest: hash(
          PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA,
          settlementCore,
        ),
      });
      if (client.persistSettlement !== null) {
        persistence = normalizePersistence(
          await client.persistSettlement(settlement),
          settlement.settlementDigest,
        );
      }
      return envelope;
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), client.timeoutMs);
  timer.unref?.();
  try {
    const signal = AbortSignal.any([runtime.signal, controller.signal]);
    let content;
    try {
      content = await chat(messages, {
        maxTokens: requestedOutputTokens,
        signal,
      });
    } catch (cause) {
      if (!controller.signal.aborted) throw cause;
      const error = new Error(
        `PM Volcengine provider timed out after ${client.timeoutMs}ms`,
        { cause },
      );
      error.code = "CC_PM_VOLCENGINE_TIMEOUT";
      throw error;
    }
    if (controller.signal.aborted) {
      const error = new Error(
        `PM Volcengine provider timed out after ${client.timeoutMs}ms`,
      );
      error.code = "CC_PM_VOLCENGINE_TIMEOUT";
      throw error;
    }
    if (
      settlement === null ||
      settlement.responseDigest !==
        hash(PM_EXPLORATION_PROVIDER_SETTLEMENT_SCHEMA, content)
    ) {
      throw new Error("PM Volcengine settlement does not bind the response");
    }
    return deepFreeze({
      schema: PM_EXPLORATION_PROVIDER_RESULT_SCHEMA,
      content,
      settlement,
      persistence,
      elapsedMs: Math.ceil(performance.now() - startedAt),
    });
  } finally {
    clearTimeout(timer);
  }
}
