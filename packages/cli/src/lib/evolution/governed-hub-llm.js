import { createRequire } from "node:module";
import { types } from "node:util";
import { prepareGovernedModelTurn } from "./governed-model-turn.js";

const { createAuthenticatedEvolutionModelClient } = createRequire(
  import.meta.url,
)("@chainlesschain/personal-data-hub/model-egress-guard");
const { OllamaClient } = createRequire(import.meta.url)(
  "@chainlesschain/personal-data-hub/llm-client",
);
const { CcLLMAdapter } = createRequire(import.meta.url)(
  "@chainlesschain/personal-data-hub/bridges/cc-llm-adapter",
);
const { EntityResolverEmbeddingStage } = createRequire(import.meta.url)(
  "@chainlesschain/personal-data-hub/entity-resolver",
);

const DEFAULT_SDK_PORTS = Object.freeze({
  createAuthenticatedEvolutionModelClient,
  OllamaClient,
  CcLLMAdapter,
  EntityResolverEmbeddingStage,
});

// A packaged Desktop has its own physical SDK copy and private client brand.
// These main-process module exports select that copy, not Evolution authority.
// Keep them separate from caller model/skill options; the factory below still
// has to produce a genuinely branded, Run-bound composition on every call.
export function captureGovernedHubSdkPorts(ports = DEFAULT_SDK_PORTS) {
  if (
    !ports ||
    typeof ports !== "object" ||
    Array.isArray(ports) ||
    types.isProxy(ports)
  )
    throw new TypeError("Host Hub SDK ports must be an object");
  const captured = {};
  for (const name of Object.keys(DEFAULT_SDK_PORTS)) {
    const descriptor = Object.getOwnPropertyDescriptor(ports, name);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "function" ||
      types.isProxy(descriptor.value)
    )
      throw new TypeError(
        `Host Hub SDK ${name} must be a function data property`,
      );
    captured[name] = descriptor.value;
  }
  return Object.freeze(captured);
}

function isLoopbackEndpoint(value) {
  if (typeof value !== "string") return false;
  try {
    const endpoint = new URL(value);
    return (
      ["http:", "https:"].includes(endpoint.protocol) &&
      (endpoint.hostname === "localhost" ||
        endpoint.hostname === "[::1]" ||
        /^127(?:\.\d{1,3}){3}$/.test(endpoint.hostname))
    );
  } catch {
    return false;
  }
}

// These transports stay private to the invocation wrapper. The SDK's public
// chat methods remain default-denied; only the wrapper below can hand this
// transport messages after a branded composition has projected them.
function captureHubTransport(llm, sdk) {
  if (
    llm instanceof sdk.OllamaClient &&
    llm.chat === sdk.OllamaClient.prototype.chat
  ) {
    const { baseUrl, model, timeoutMs, _fetch: fetchImpl } = llm;
    return {
      // The SDK labels Ollama as local even for a remote baseUrl. Preserve
      // stricter host policy, but never let that label waive cloud consent.
      isLocal: isLoopbackEndpoint(baseUrl),
      assertIdentity() {
        if (
          llm.baseUrl !== baseUrl ||
          llm.model !== model ||
          llm.timeoutMs !== timeoutMs ||
          llm._fetch !== fetchImpl
        )
          throw new Error(
            "Hub model identity changed; reopen the analysis invocation",
          );
      },
      async chat(messages, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const signal = options.signal
            ? AbortSignal.any([controller.signal, options.signal])
            : controller.signal;
          const response = await fetchImpl(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            redirect: "error",
            signal,
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              options: {
                temperature: options.temperature ?? 0.2,
                ...(options.numCtx ? { num_ctx: options.numCtx } : {}),
              },
            }),
          });
          if (!response.ok)
            throw new Error(
              `Hub Ollama request failed: HTTP ${response.status}`,
            );
          const data = await response.json();
          if (
            data?.error ||
            data?.done !== true ||
            typeof data?.message?.content !== "string"
          )
            throw new Error(
              "Hub Ollama response did not contain a completed text answer",
            );
          return {
            text: data.message.content,
            model,
            usage: {
              promptTokens: data.prompt_eval_count ?? 0,
              completionTokens: data.eval_count ?? 0,
              totalTokens:
                (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
            },
          };
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }
  if (
    llm instanceof sdk.CcLLMAdapter &&
    llm.chat === sdk.CcLLMAdapter.prototype.chat
  ) {
    const chat = llm._chat;
    const getActiveClient = llm._getActiveClient;
    const getActiveProvider = llm._getActiveProvider;
    const getActiveModel = llm._getActiveModel;
    const provider = getActiveProvider?.();
    const model = getActiveModel?.();
    const client = getActiveClient?.();
    const networkIdentity = {
      baseURL: client?.baseURL,
      host: client?.host,
      model: client?.model,
      chat: client?.chat,
    };
    const httpClient = client?.client;
    const defaults = httpClient?.defaults;
    const httpIdentity = {
      baseURL: defaults?.baseURL,
      post: httpClient?.post,
      request: httpClient?.request,
    };
    const endpoint = networkIdentity.baseURL || networkIdentity.host;
    if (httpClient && endpoint && httpIdentity.baseURL !== endpoint) {
      const error = new Error(
        "Hub Desktop endpoint does not match its selected HTTP client",
      );
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }
    return {
      // A provider label such as "ollama" does not establish locality. The
      // host must expose its selected client; absent URL evidence is remote.
      isLocal:
        isLoopbackEndpoint(endpoint) &&
        (!httpClient || httpIdentity.baseURL === endpoint),
      assertIdentity() {
        if (
          llm._chat !== chat ||
          llm._getActiveClient !== getActiveClient ||
          llm._getActiveProvider !== getActiveProvider ||
          llm._getActiveModel !== getActiveModel ||
          getActiveProvider?.() !== provider ||
          getActiveModel?.() !== model ||
          getActiveClient?.() !== client ||
          client?.client !== httpClient ||
          httpClient?.defaults !== defaults ||
          defaults?.baseURL !== httpIdentity.baseURL ||
          httpClient?.post !== httpIdentity.post ||
          httpClient?.request !== httpIdentity.request ||
          Object.entries(networkIdentity).some(
            ([key, value]) => client?.[key] !== value,
          )
        )
          throw new Error(
            "Hub model identity changed; reopen the analysis invocation",
          );
      },
      async chat(messages, options) {
        const result = await chat(messages, options);
        const text =
          result?.content ??
          result?.text ??
          result?.message?.content ??
          result?.choices?.[0]?.message?.content;
        if (typeof text !== "string")
          throw new Error("Hub Desktop response must contain text");
        const usage = result?.usage ?? {};
        const promptTokens =
          usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const completionTokens =
          usage.completionTokens ??
          usage.completion_tokens ??
          usage.output_tokens ??
          0;
        return {
          text,
          model: result.model,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens:
              usage.totalTokens ??
              usage.total_tokens ??
              promptTokens + completionTokens,
          },
        };
      },
    };
  }
  return { assertIdentity() {}, chat: llm.chat.bind(llm) };
}

// A scoped wrapper preserves the Hub's independent local/cloud consent check.
// Never replace llm on the process-wide cached Hub or its analysis engine.
export function createGovernedHubLlm(llm, factory, options = {}, sdkPorts) {
  if (
    !llm ||
    typeof llm.chat !== "function" ||
    typeof llm.isLocal !== "boolean"
  ) {
    throw new TypeError(
      "A Hub model client with declared locality is required",
    );
  }
  if (typeof factory !== "function")
    throw new TypeError("A Hub evolution factory is required");
  if (options.onFailure != null && typeof options.onFailure !== "function")
    throw new TypeError("onFailure must be a function");
  const sdk = captureGovernedHubSdkPorts(sdkPorts);
  const identity = { name: llm.name, isLocal: llm.isLocal, chat: llm.chat };
  const transport = captureHubTransport(llm, sdk);
  const assertIdentity = () => {
    if (
      llm.name !== identity.name ||
      llm.isLocal !== identity.isLocal ||
      llm.chat !== identity.chat
    ) {
      throw new Error(
        "Hub model identity changed; reopen the analysis invocation",
      );
    }
    transport.assertIdentity();
  };
  return sdk.createAuthenticatedEvolutionModelClient({
    getName() {
      assertIdentity();
      return identity.name;
    },
    getIsLocal() {
      assertIdentity();
      return identity.isLocal && transport.isLocal !== false;
    },
    async prepare(messages, chatOptions = {}) {
      assertIdentity();
      return await prepareGovernedModelTurn(factory, {
        mode: "hub-analysis",
        messages,
        signal: chatOptions.signal,
      });
    },
    async transport(messages, chatOptions = {}) {
      assertIdentity();
      const response = await transport.chat(messages, chatOptions);
      assertIdentity();
      return response;
    },
    onFailure: options.onFailure,
  });
}
