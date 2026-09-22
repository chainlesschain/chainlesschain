import { openDecisionProviderAuthority } from "./provider-authority.js";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";

function endpointFor(baseUrl) {
  const parsed = new URL(baseUrl || DEFAULT_BASE_URL);
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "127.0.0.1" &&
    parsed.hostname !== "localhost"
  ) {
    throw new TypeError("decision provider URL must use HTTPS or loopback");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/systemone`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function boundedSecret(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8192) {
    throw new TypeError("TypeSafe API key is required");
  }
  return value;
}

function providerError(status) {
  const error = new Error(
    `TypeSafe decision request failed with status ${status}`,
  );
  error.code = "CC_DECISION_PROVIDER_HTTP_ERROR";
  error.status = status;
  return error;
}

export function createTypeSafeDecisionProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = "jev-latest",
  fetchImpl = globalThis.fetch,
} = {}) {
  const secret = boundedSecret(apiKey);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("decision provider fetch implementation is required");
  }
  const endpoint = endpointFor(baseUrl);
  return openDecisionProviderAuthority({
    provider: "typesafe",
    model,
    decide: async (request, { signal } = {}) => {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          state: request.payload.state,
          questions: request.payload.questions,
        }),
        signal,
      });
      if (!response?.ok) throw providerError(response?.status ?? 0);
      const body = await response.json();
      return {
        provider: "typesafe",
        model: typeof body?.model === "string" ? body.model : model,
        answers: body?.answers,
        usage: body?.usage,
      };
    },
  });
}
