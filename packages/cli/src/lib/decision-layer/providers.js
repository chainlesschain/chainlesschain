import { openDecisionProviderAuthority } from "./provider-authority.js";

const PROVIDERS = Object.freeze({
  typesafe: {
    model: "jev-latest",
    baseUrl: "https://api.typesafe.ai",
    label: "TypeSafe",
  },
  laya: {
    model: "laya",
    baseUrl: "http://127.0.0.1:8000",
    label: "Laya",
  },
  "system-one": { label: "System One" },
});

export const MAX_DECISION_REQUEST_BYTES = 256 * 1024;
export const MAX_DECISION_RESPONSE_BYTES = 256 * 1024;

function boundedText(value, label, limit = 160) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > limit ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} is required and must be bounded text`);
  }
  return value.trim();
}

function endpointFor(baseUrl, provider) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("decision provider URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || /[?#]/u.test(baseUrl)) {
    throw new TypeError(
      "decision provider URL must not contain credentials, a query, or a fragment",
    );
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    parsed.hostname,
  );
  if (provider === "laya" && !loopback) {
    throw new TypeError("Laya decision provider URL must use loopback");
  }
  if (parsed.protocol !== "https:" && !loopback) {
    throw new TypeError("decision provider URL must use HTTPS or loopback");
  }
  const path = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = path.endsWith("/v1/systemone")
    ? path
    : path.endsWith("/v1")
      ? `${path}/systemone`
      : `${path}/v1/systemone`;
  return parsed.toString();
}

export function resolveDecisionProviderOptions({
  decisionProvider = "typesafe",
  decisionModel,
  decisionBaseUrl,
} = {}) {
  const provider = boundedText(decisionProvider, "decision provider");
  if (!Object.hasOwn(PROVIDERS, provider)) {
    throw new TypeError(`unknown decision provider: ${provider}`);
  }
  const defaults = PROVIDERS[provider];
  const model = boundedText(decisionModel ?? defaults.model, "decision model");
  const baseUrl = boundedText(
    decisionBaseUrl ?? defaults.baseUrl,
    "decision base URL",
    4096,
  );
  endpointFor(baseUrl, provider);
  return { provider, model, baseUrl };
}

function boundedSecret(value, provider) {
  if (value === undefined && provider !== "typesafe") return undefined;
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 8192 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(
      `${PROVIDERS[provider].label} API key is required or invalid`,
    );
  }
  return value;
}

function providerError(status, provider) {
  const error = new Error(
    `${PROVIDERS[provider].label} decision request failed with status ${status}`,
  );
  error.code = "CC_DECISION_PROVIDER_HTTP_ERROR";
  error.status = status;
  return error;
}

function bodyTooLarge(kind, maximum) {
  const error = new Error(`decision ${kind} exceeds ${maximum} bytes`);
  error.code = `CC_DECISION_${kind.toUpperCase()}_TOO_LARGE`;
  return error;
}

async function readBoundedJsonResponse(response) {
  const declared = response.headers?.get?.("content-length");
  if (
    declared != null &&
    /^\d+$/u.test(declared) &&
    BigInt(declared) > BigInt(MAX_DECISION_RESPONSE_BYTES)
  ) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The declared size remains authoritative even if cancellation fails.
    }
    throw bodyTooLarge("response", MAX_DECISION_RESPONSE_BYTES);
  }

  // A real Fetch Response has a stream; injected test transports may only
  // expose json(). The latter is checked after parsing because it is trusted.
  if (!response.body?.getReader) {
    const value = await response.json();
    if (
      Buffer.byteLength(JSON.stringify(value), "utf8") >
      MAX_DECISION_RESPONSE_BYTES
    ) {
      throw bodyTooLarge("response", MAX_DECISION_RESPONSE_BYTES);
    }
    return value;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkBytes = value?.byteLength;
      if (
        !Number.isSafeInteger(chunkBytes) ||
        total + chunkBytes > MAX_DECISION_RESPONSE_BYTES
      ) {
        throw bodyTooLarge("response", MAX_DECISION_RESPONSE_BYTES);
      }
      const chunk = Buffer.from(value);
      total += chunk.length;
      chunks.push(chunk);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, total)));
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original read, size, or JSON error remains authoritative.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createDecisionProvider({
  provider,
  model,
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  const options = resolveDecisionProviderOptions({
    decisionProvider: provider,
    decisionModel: model,
    decisionBaseUrl: baseUrl,
  });
  const secret = boundedSecret(apiKey, options.provider);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("decision provider fetch implementation is required");
  }
  const endpoint = endpointFor(options.baseUrl, options.provider);
  return openDecisionProviderAuthority({
    provider: options.provider,
    model: options.model,
    decide: async (request, { signal } = {}) => {
      const body = JSON.stringify({
        model: options.model,
        state: request.payload.state,
        questions: request.payload.questions,
      });
      if (Buffer.byteLength(body, "utf8") > MAX_DECISION_REQUEST_BYTES) {
        throw bodyTooLarge("request", MAX_DECISION_REQUEST_BYTES);
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          ...(secret === undefined
            ? {}
            : { authorization: `Bearer ${secret}` }),
          "content-type": "application/json",
        },
        body,
        signal,
        redirect: "error",
      });
      if (!response?.ok) {
        throw providerError(response?.status ?? 0, options.provider);
      }
      const responseBody = await readBoundedJsonResponse(response);
      return {
        provider: options.provider,
        model:
          typeof responseBody?.model === "string"
            ? responseBody.model
            : options.model,
        answers: responseBody?.answers,
        usage: responseBody?.usage,
      };
    },
  });
}
