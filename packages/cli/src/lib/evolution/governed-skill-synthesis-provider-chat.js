import { types as utilTypes } from "node:util";

import { createChatFn } from "../cowork-adapter.js";
import { BUILT_IN_PROVIDERS } from "../llm-providers.js";

const PORTS = new WeakSet();
const OPTION_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "evolutionIngress",
  "maxTokens",
  "model",
  "provider",
  "timeoutMs",
]);
const MESSAGE_ROLES = new Set(["assistant", "system", "user"]);
const MAX_MESSAGES = 8;
const MAX_PROMPT_BYTES = 64 * 1024;

function plainDataRecord(value, label, allowedKeys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError(`${label} contains unsupported fields`);
    }
  }
  return value;
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function boundedContent(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be non-empty bounded text`);
  }
  return value;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function normalizeBaseUrl(provider, value) {
  const providerDefinition = BUILT_IN_PROVIDERS[provider];
  const baseUrl = value || providerDefinition.baseUrl;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError("learning synthesis provider baseUrl is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError(
      "learning synthesis cloud provider baseUrl must be credential-free HTTPS",
    );
  }
  const expected = new URL(providerDefinition.baseUrl);
  const normalized = parsed.href.replace(/\/$/u, "");
  const expectedNormalized = expected.href.replace(/\/$/u, "");
  if (normalized !== expectedNormalized) {
    throw new TypeError(
      "learning synthesis provider baseUrl must match the built-in provider endpoint",
    );
  }
  return normalized;
}

function normalizeMessages(messages) {
  if (
    !Array.isArray(messages) ||
    utilTypes.isProxy(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES
  ) {
    throw new TypeError(
      `learning synthesis messages must contain 1 to ${MAX_MESSAGES} entries`,
    );
  }
  let bytes = 0;
  const normalized = messages.map((message, index) => {
    plainDataRecord(
      message,
      `learning synthesis message ${index}`,
      new Set(["content", "role"]),
    );
    if (!MESSAGE_ROLES.has(message.role)) {
      throw new TypeError(
        `learning synthesis message ${index} role is invalid`,
      );
    }
    const content = boundedContent(
      message.content,
      `learning synthesis message ${index} content`,
      MAX_PROMPT_BYTES,
    );
    bytes += Buffer.byteLength(content, "utf8");
    return Object.freeze({ role: message.role, content });
  });
  if (bytes > MAX_PROMPT_BYTES) {
    throw new TypeError(
      `learning synthesis prompt exceeds ${MAX_PROMPT_BYTES} bytes`,
    );
  }
  return Object.freeze(normalized);
}

/**
 * Create the narrow provider egress used by a signed learning deployment.
 * Credentials stay in the closure and are never exposed on the returned port.
 */
export function createGovernedSkillSynthesisProviderChat(options = {}) {
  plainDataRecord(options, "learning synthesis provider options", OPTION_KEYS);
  const provider = boundedString(
    options.provider,
    "learning synthesis provider",
    64,
  );
  if (provider === "ollama" || !Object.hasOwn(BUILT_IN_PROVIDERS, provider)) {
    throw new TypeError(
      "learning synthesis provider must be a supported cloud provider",
    );
  }
  const model = boundedString(
    options.model || BUILT_IN_PROVIDERS[provider].models[0],
    "learning synthesis model",
    256,
  );
  const apiKey = boundedString(
    options.apiKey,
    "learning synthesis provider credential",
    16 * 1024,
  );
  const baseUrl = normalizeBaseUrl(provider, options.baseUrl);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? 30_000,
    "learning synthesis provider timeoutMs",
    1_000,
    120_000,
  );
  const maxTokens = boundedInteger(
    options.maxTokens ?? 2_048,
    "learning synthesis provider maxTokens",
    128,
    4_096,
  );
  const chat = createChatFn({
    provider,
    model,
    baseUrl,
    apiKey,
    ...(options.evolutionIngress == null
      ? {}
      : { evolutionIngress: options.evolutionIngress }),
  });

  const port = async (messages) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      return await chat(normalizeMessages(messages), {
        maxTokens,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const timeout = new Error(
          `learning synthesis provider timed out after ${timeoutMs}ms`,
          { cause: error },
        );
        timeout.code = "LEARNING_SYNTHESIS_PROVIDER_TIMEOUT";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  Object.freeze(port);
  PORTS.add(port);
  return port;
}

export function isGovernedSkillSynthesisProviderChat(value) {
  return PORTS.has(value);
}
